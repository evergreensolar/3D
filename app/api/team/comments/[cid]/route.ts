import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";

/** Resolve / reopen a comment: { resolved: boolean }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { cid } = await params;
  const { resolved } = (await req.json().catch(() => ({}))) as { resolved?: boolean };
  const c = await db.comment.update({ where: { id: cid }, data: resolved ? { resolvedAt: new Date(), resolvedById: user.id } : { resolvedAt: null, resolvedById: null } });
  // all customer comments resolved → back to "Sent to customer"
  const open = await db.comment.count({ where: { projectId: c.projectId, parentId: null, resolvedAt: null, authorType: "CUSTOMER" } });
  if (!open) await db.project.updateMany({ where: { id: c.projectId, status: "COMMENTS_PENDING" }, data: { status: "SENT_TO_CUSTOMER" } });
  return NextResponse.json({ ok: true });
}
