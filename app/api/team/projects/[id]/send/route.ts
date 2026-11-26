import { NextResponse } from "next/server";
import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { latestReadyVersion, logEvent } from "@/lib/projects";
import { storage, absoluteUrl } from "@/lib/storage";
import { dispatch } from "@/lib/notify";
import { templates } from "@/lib/notify/templates";
import { env } from "@/lib/env";

/** Sends the live 3D link (and the PDF where the channel allows) to the customer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { channels } = (await req.json().catch(() => ({}))) as { channels?: Channel[] };
  const chosen = (channels ?? []).filter((c): c is Channel => ["WHATSAPP", "SMS", "EMAIL"].includes(c));
  if (!chosen.length) return NextResponse.json({ error: "Choose at least one channel" }, { status: 400 });

  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const version = await latestReadyVersion(id);
  if (!version?.reportKey) return NextResponse.json({ error: "The design is still processing" }, { status: 409 });
  if (chosen.includes("EMAIL") && !project.customerEmail) return NextResponse.json({ error: "No customer email on this project" }, { status: 400 });

  const link = `${env.appUrl}/p/${project.shareToken}`;
  const filename = `${project.code}-design-v${version.number}.pdf`;
  const pdfUrl = absoluteUrl(await storage().getUrl(version.reportKey, { expiresInSec: 7 * 24 * 3600, downloadName: filename }));
  const base = { projectCode: project.code, systemSizeKw: project.systemSizeKw, version: version.number, link };

  const results = [];
  for (const channel of chosen) {
    // SMS: short, link only. WhatsApp: PDF as document. Email: PDF attached.
    const rendered = templates.reportReady(project, channel === "SMS" ? base : { ...base, reportUrl: channel === "EMAIL" ? undefined : pdfUrl });
    const document = channel === "SMS" ? undefined
      : channel === "EMAIL" ? { url: pdfUrl, filename, content: await storage().get(version.reportKey) }
      : { url: pdfUrl, filename };
    results.push(...(await dispatch({
      projectId: id, template: "report_ready", rendered, channels: [channel],
      to: { mobile: project.customerMobile, email: project.customerEmail }, document,
    })));
  }
  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    await db.project.update({
      where: { id },
      data: { sentToCustomerAt: new Date(), ...(project.status === "UPLOADED" ? { status: "SENT_TO_CUSTOMER" } : {}) },
    });
    await logEvent(id, "report.sent", `user:${user.id}`, { version: version.number, channels: results.filter((r) => r.ok).map((r) => r.channel) });
  }
  return NextResponse.json({ ok: anyOk, results }, { status: anyOk ? 200 : 502 });
}
