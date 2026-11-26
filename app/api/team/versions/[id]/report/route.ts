import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { storage } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const v = await db.designVersion.findUnique({ where: { id }, include: { project: { select: { code: true } } } });
  if (!v?.reportKey) return NextResponse.json({ error: "Report not ready" }, { status: 404 });
  const inline = new URL(req.url).searchParams.has("view");
  const url = await storage().getUrl(v.reportKey, { expiresInSec: 600, downloadName: inline ? undefined : `${v.project.code}-design-v${v.number}.pdf` });
  return NextResponse.redirect(new URL(url, req.url));
}
