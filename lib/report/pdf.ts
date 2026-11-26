// Generates the customer-facing design report PDF (runs in the worker).
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { Project, DesignVersion } from "@prisma/client";
import type { ShadingSummary } from "@/lib/scene/shading";
import { addressCustomer } from "@/lib/notify/address";
import { formatIST, MONTHS } from "@/lib/time";

export interface ReportImage {
  label: string;
  kind: "view" | "shading";
  jpeg: Buffer;
  shadedPct?: number;
  shadedPanels?: number;
}

const GREEN = "#15803d";
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const BAR = "#3b5bdb";

export async function buildReportPdf(o: {
  project: Project;
  version: DesignVersion;
  images: ReportImage[];
  summary: ShadingSummary;
  liveUrl: string;
  detectedPanelCount: number;
}): Promise<Buffer> {
  const { project: p, version: v, summary } = o;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Solar design report ${p.code} v${v.number}`, Author: "Evergreen Solar" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const pageW = doc.page.width - 80; // content width
  const qr = await QRCode.toBuffer(o.liveUrl, { margin: 1, width: 360, color: { dark: "#052e16" } });
  const views = o.images.filter((i) => i.kind === "view");
  const shades = o.images.filter((i) => i.kind === "shading");

  const header = (title: string) => {
    doc.rect(0, 0, doc.page.width, 64).fill(GREEN);
    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(16).text("Evergreen Solar", 40, 18);
    doc.font("Helvetica").fontSize(9).text("Rooftop Solar EPC  ·  West Bengal", 40, 40);
    doc.font("Helvetica-Bold").fontSize(11).text(title, 40, 26, { width: pageW, align: "right" });
    doc.fill(INK);
    doc.y = 84;
  };

  // ---------------- Page 1: project summary
  header(`Design report · ${p.code} · Version ${v.number}`);
  doc.font("Helvetica-Bold").fontSize(20).text(`${p.systemSizeKw} kW Rooftop Solar System`, 40, doc.y);
  doc.moveDown(0.2).font("Helvetica").fontSize(11).fill(MUTED)
    .text(`Prepared for ${addressCustomer(p)}  ·  ${formatIST(v.processedAt ?? new Date(), { dateStyle: "long" })}`);
  doc.fill(INK).moveDown(0.8);

  const hero = views[0];
  if (hero) {
    const y = doc.y;
    doc.image(hero.jpeg, 40, y, { width: pageW, height: pageW * 0.625 });
    doc.y = y + pageW * 0.625 + 4;
    doc.font("Helvetica").fontSize(8).fill(MUTED).text(hero.label, 40, doc.y, { width: pageW, align: "right" }).fill(INK);
  }
  doc.moveDown(0.6);

  const rows: [string, string][] = [
    ["Customer", `${addressCustomer(p)}`],
    ["Mobile", p.customerMobile],
    ["Site address", p.address],
    ["Site coordinates", `${p.latitude.toFixed(5)}° N, ${p.longitude.toFixed(5)}° E`],
    ["System size", `${p.systemSizeKw} kWp`],
    ["Panels", `${p.panelCount} × ${p.panelMake} ${p.panelModel}${p.panelWattage ? ` (${p.panelWattage} W)` : ""}`],
    ["Mounting structure", `${p.structureType}, ${p.structureHeightM} m high`],
    ["Annual shading (9 AM–4 PM)", `${summary.annualPct}% of panel area on average`],
  ];
  const tableTop = doc.y;
  const colW = pageW - 150;
  let y = tableTop;
  for (const [k, val] of rows) {
    const h = Math.max(16, doc.font("Helvetica").fontSize(10).heightOfString(val, { width: colW - 150 }) + 6);
    doc.font("Helvetica").fontSize(9).fill(MUTED).text(k, 40, y + 3, { width: 140 });
    doc.font("Helvetica").fontSize(10).fill(INK).text(val, 180, y + 3, { width: colW - 150 });
    y += h;
    doc.moveTo(40, y).lineTo(40 + colW - 10, y).lineWidth(0.5).strokeColor(RULE).stroke();
  }
  // QR block on the right of the table
  const qrX = 40 + pageW - 130;
  doc.image(qr, qrX, tableTop, { width: 130 });
  doc.font("Helvetica-Bold").fontSize(9).fill(GREEN).text("See it live in 3D", qrX, tableTop + 134, { width: 130, align: "center" });
  doc.font("Helvetica").fontSize(7.5).fill(MUTED).text("Scan with your phone camera", qrX, tableTop + 146, { width: 130, align: "center" });
  doc.y = Math.max(y, tableTop + 160) + 10;
  doc.font("Helvetica").fontSize(9).fill(INK).text("Live 3D design with sun & shadows: ", 40, doc.y, { continued: true })
    .fill(GREEN).text(o.liveUrl, { link: o.liveUrl, underline: true });
  doc.fill(INK);

  // ---------------- Page 2: model views
  doc.addPage();
  header("3D model views");
  const gridImg = (img: ReportImage, x: number, yy: number, w: number) => {
    const h = w * 0.625;
    doc.image(img.jpeg, x, yy, { width: w, height: h });
    doc.rect(x, yy, w, h).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fill(INK).text(img.label, x, yy + h + 4, { width: w });
    if (img.shadedPct !== undefined) {
      doc.font("Helvetica").fontSize(8.5).fill(MUTED)
        .text(`${img.shadedPct}% of panel area shaded · ${img.shadedPanels} panel${img.shadedPanels === 1 ? "" : "s"} affected`, x, yy + h + 16, { width: w });
    }
    doc.fill(INK);
    return h + 34;
  };
  {
    const w = pageW;
    let yy = doc.y;
    // 3 remaining views stacked as a 1 + 2 layout
    const rest = views.slice(1);
    if (rest[0]) yy += gridImg(rest[0], 40, yy, w * 0.75 + 0) + 6;
    const half = (w - 12) / 2;
    if (rest[1]) gridImg(rest[1], 40, yy, half);
    if (rest[2]) gridImg(rest[2], 40 + half + 12, yy, half);
  }

  // ---------------- Page 3: shading snapshots
  doc.addPage();
  header("Shading at key times");
  doc.font("Helvetica").fontSize(9.5).fill(MUTED)
    .text("Panels highlighted in orange are partly shaded and in red mostly shaded at that moment. Shadows are computed from the real sun position at the site.", 40, doc.y, { width: pageW });
  doc.fill(INK).moveDown(0.6);
  {
    const colW2 = (pageW - 12) / 2;
    let yy = doc.y;
    // Summer left column, winter right column; rows = 9 AM, 12, 3 PM
    const summer = shades.filter((s) => s.label.startsWith("Summer"));
    const winter = shades.filter((s) => s.label.startsWith("Winter"));
    for (let i = 0; i < 3; i++) {
      const hs = summer[i] ? gridImg(summer[i], 40, yy, colW2) : 0;
      const hw = winter[i] ? gridImg(winter[i], 40 + colW2 + 12, yy, colW2) : 0;
      yy += Math.max(hs, hw) + 4;
    }
  }

  // ---------------- Page 4: monthly summary
  doc.addPage();
  header("Yearly shading summary");
  doc.font("Helvetica-Bold").fontSize(13).text("Share of panel area in shade, by month (9 AM – 4 PM)", 40, doc.y);
  doc.moveDown(0.3).font("Helvetica").fontSize(9).fill(MUTED).text(summary.method, { width: pageW });
  doc.fill(INK).moveDown(0.8);

  // Bar chart: single series, recessive grid, value labels on bars only where meaningful.
  const chartX = 70, chartY = doc.y + 6, chartW = pageW - 40, chartH = 200;
  const maxV = Math.max(10, Math.ceil(Math.max(...summary.months.map((m) => m.shadedPct)) / 5) * 5);
  doc.font("Helvetica").fontSize(8).fill(MUTED);
  for (let t = 0; t <= 4; t++) {
    const val = (maxV * t) / 4;
    const gy = chartY + chartH - (chartH * t) / 4;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).lineWidth(0.5).strokeColor(t === 0 ? "#9ca3af" : RULE).stroke();
    doc.text(`${val % 1 ? val.toFixed(1) : val}%`, chartX - 34, gy - 4, { width: 28, align: "right" });
  }
  const slot = chartW / 12;
  const bw = slot * 0.56;
  summary.months.forEach((m, i) => {
    const h = (chartH * m.shadedPct) / maxV;
    const x = chartX + i * slot + (slot - bw) / 2;
    if (h > 0.5) doc.roundedRect(x, chartY + chartH - h, bw, h + 0.01, Math.min(3, h / 2)).fill(BAR);
    doc.fill(INK).fontSize(8).text(`${m.shadedPct}`, x - 6, chartY + chartH - h - 11, { width: bw + 12, align: "center" });
    doc.fill(MUTED).text(MONTHS[i], x - 6, chartY + chartH + 5, { width: bw + 12, align: "center" });
  });
  doc.fill(INK);
  doc.y = chartY + chartH + 30;

  // Hour × month table
  doc.font("Helvetica-Bold").fontSize(11).text("Detail: % panel area shaded by time of day", 40, doc.y);
  doc.moveDown(0.4);
  const hours = summary.hours.filter((h) => Number.isInteger(h));
  const hIdx = hours.map((h) => summary.hours.indexOf(h));
  const tx = 40, cw = (pageW - 50) / (hours.length + 1);
  let ty = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fill(MUTED).text("Month", tx, ty, { width: 50 });
  hours.forEach((h, j) => doc.text(h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`, tx + 50 + j * cw, ty, { width: cw, align: "center" }));
  doc.text("Avg", tx + 50 + hours.length * cw, ty, { width: cw, align: "center" });
  ty += 13;
  summary.matrix.forEach((row, mi) => {
    if (mi % 2 === 0) doc.rect(tx, ty - 2, pageW, 12).fill("#f9fafb");
    doc.fill(INK).font("Helvetica").fontSize(8).text(MONTHS[mi], tx + 2, ty, { width: 48 });
    hIdx.forEach((k, j) => doc.text(`${row[k]}`, tx + 50 + j * cw, ty, { width: cw, align: "center" }));
    doc.font("Helvetica-Bold").text(`${summary.months[mi].shadedPct}`, tx + 50 + hours.length * cw, ty, { width: cw, align: "center" });
    ty += 12;
  });
  doc.y = ty + 12;
  const notes = [
    `Panels found in the 3D model: ${o.detectedPanelCount}${o.detectedPanelCount !== p.panelCount ? ` (project specifies ${p.panelCount})` : ""}. Total panel area analysed: ${summary.panelAreaM2} m².`,
    "Shading here means the panel surface does not receive direct sunlight at that moment because an object (parapet, water tank, stair room, neighbouring building, tree, another panel row) blocks the sun. Diffuse light and weather are not included.",
    "This report is generated from the design model and is indicative. The installation follows the design version approved by the customer.",
  ];
  doc.font("Helvetica").fontSize(8.5).fill(MUTED);
  notes.forEach((n) => doc.text(`•  ${n}`, 40, doc.y, { width: pageW }).moveDown(0.3));

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fill(MUTED)
      .text(`${p.code} · Version ${v.number} · Generated ${formatIST(new Date())}`, 40, doc.page.height - 28, { width: pageW / 2 })
      .text(`Page ${i + 1} of ${range.count}`, 40 + pageW / 2, doc.page.height - 28, { width: pageW / 2, align: "right" });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
