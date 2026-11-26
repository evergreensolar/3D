import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storage, keys } from "@/lib/storage";
import { signedQuery } from "@/lib/storage/sign";
import { buildReportPdf, type ReportImage } from "@/lib/report/pdf";
import type { ShadingSummary } from "@/lib/scene/shading";
import { logEvent } from "@/lib/projects";
import { getBrowser } from "./browser";
import { optimizeGlb } from "./optimize";

interface RenderResult {
  ok: boolean;
  error?: string;
  log: string[];
  glbBase64?: string;
  snapshots: { name: string; label: string; kind: "view" | "shading"; dataUrl: string; month?: number; hour?: number; shadedPct?: number; shadedPanels?: number }[];
  summary: ShadingSummary;
  panelCount: number;
  bbox: { min: number[]; max: number[] };
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export async function processVersion(versionId: string, finalAttempt: boolean) {
  const version = await db.designVersion.findUnique({ where: { id: versionId }, include: { project: true } });
  if (!version) throw new Error(`Version ${versionId} not found`);
  const { project } = version;
  await db.designVersion.update({ where: { id: versionId }, data: { status: "PROCESSING", processingError: null } });
  const s = storage();

  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
  try {
    const url = `${appUrl()}/render/${versionId}?${signedQuery(`render:${versionId}`, 1800)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => !!(window as unknown as { __EVG_RESULT?: unknown }).__EVG_RESULT, null, { timeout: 10 * 60_000, polling: 500 });
    const result = (await page.evaluate(() => (window as unknown as { __EVG_RESULT: unknown }).__EVG_RESULT)) as RenderResult;
    if (!result.ok) throw new Error(result.error || "Rendering failed");

    // 1. Viewer model (converted from DAE if needed), optimised.
    const raw = result.glbBase64 ? Buffer.from(result.glbBase64, "base64") : await s.get(version.originalKey);
    let glb: Uint8Array = raw;
    try {
      glb = await optimizeGlb(raw);
    } catch (e) {
      result.log.push(`optimize skipped: ${(e as Error).message}`);
    }
    const modelKey = keys.model(project.id, version.number);
    await s.put(modelKey, glb, { contentType: "model/gltf-binary" });

    // 2. Snapshots.
    const images: ReportImage[] = [];
    const snapMeta: Prisma.InputJsonValue[] = [];
    for (const snap of result.snapshots) {
      const jpeg = Buffer.from(snap.dataUrl.split(",")[1], "base64");
      const key = keys.snapshot(project.id, version.number, snap.name);
      await s.put(key, jpeg, { contentType: "image/jpeg" });
      images.push({ label: snap.label, kind: snap.kind, jpeg, shadedPct: snap.shadedPct, shadedPanels: snap.shadedPanels });
      const { dataUrl: _, ...meta } = snap;
      void _;
      snapMeta.push({ ...meta, key });
    }

    // 3. PDF report.
    const liveUrl = `${appUrl()}/p/${project.shareToken}`;
    const processedAt = new Date();
    const pdf = await buildReportPdf({
      project, version: { ...version, processedAt }, images, summary: result.summary, liveUrl, detectedPanelCount: result.panelCount,
    });
    const reportKey = keys.report(project.id, version.number);
    await s.put(reportKey, pdf, { contentType: "application/pdf" });

    await db.designVersion.update({
      where: { id: versionId },
      data: {
        status: "READY",
        modelKey,
        modelBytes: glb.byteLength,
        reportKey,
        snapshots: snapMeta,
        shadingSummary: result.summary as unknown as Prisma.InputJsonValue,
        detectedPanelCount: result.panelCount,
        bbox: result.bbox,
        processedAt,
        processingError: null,
        processingLog: result.log.join("\n").slice(0, 20000),
      },
    });
    await logEvent(project.id, "version.ready", "system", { version: version.number, panels: result.panelCount, annualShadingPct: result.summary.annualPct });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.designVersion.update({
      where: { id: versionId },
      data: {
        status: finalAttempt ? "FAILED" : "QUEUED",
        processingError: msg.slice(0, 2000),
        processingLog: consoleLines.slice(-80).join("\n"),
      },
    });
    throw e;
  } finally {
    await ctx.close();
  }
}
