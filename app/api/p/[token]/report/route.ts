import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasCustomerSession } from "@/lib/auth/session";
import { latestReadyVersion } from "@/lib/projects";
import { storage } from "@/lib/storage";

/** Customer PDF download (needs a verified session). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await db.project.findUnique({ where: { shareToken: token } });
  if (!project || !(await hasCustomerSession(project))) return NextResponse.redirect(new URL(`/p/${token}`, req.url));
  const v = await latestReadyVersion(project.id);
  if (!v?.reportKey) return NextResponse.json({ error: "Report not ready" }, { status: 404 });
  const url = await storage().getUrl(v.reportKey, { expiresInSec: 600, downloadName: `${project.code}-design-v${v.number}.pdf` });
  return NextResponse.redirect(new URL(url, req.url));
}
