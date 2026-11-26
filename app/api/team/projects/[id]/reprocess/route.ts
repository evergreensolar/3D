import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs";

/** Re-run processing (e.g. after correcting the site coordinates or north rotation). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user || user.role === "SALES") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string };
  const version = await db.designVersion.findFirst({
    where: versionId ? { id: versionId, projectId: id } : { projectId: id },
    orderBy: { number: "desc" },
  });
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (version.lockedAt) return NextResponse.json({ error: "This version is approved and locked" }, { status: 409 });
  await db.designVersion.update({ where: { id: version.id }, data: { status: "QUEUED", processingError: null } });
  await enqueue("process_version", { versionId: version.id });
  return NextResponse.json({ ok: true });
}
