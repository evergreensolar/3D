import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { bookMeeting, cancelMeeting, SlotTakenError } from "@/lib/meetings";
import { logEvent } from "@/lib/projects";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("notes"), notes: z.string().max(10000) }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reschedule"), start: z.string().datetime() }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ mid: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { mid } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const m = await db.meeting.findUnique({ where: { id: mid }, include: { project: { include: { designer: true } } } });
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = parsed.data;
  if (d.action === "cancel") await cancelMeeting(m.id, user.id, d.reason);
  else if (d.action === "notes") {
    await db.meeting.update({ where: { id: m.id }, data: { notes: d.notes } });
    await logEvent(m.projectId, "meeting.notes", `user:${user.id}`);
  } else if (d.action === "complete") await db.meeting.update({ where: { id: m.id }, data: { status: "COMPLETED" } });
  else {
    try {
      const n = await bookMeeting(m.project, new Date(d.start), "TEAM");
      await cancelMeeting(m.id, user.id, "Rescheduled");
      await db.meeting.update({ where: { id: n.id }, data: { rescheduledFromId: m.id } });
    } catch (e) {
      if (e instanceof SlotTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  }
  return NextResponse.json({ ok: true });
}
