import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { customerProject } from "@/lib/customer";
import { bookMeeting, cancelMeeting, SlotTakenError } from "@/lib/meetings";

/** Book (or reschedule) a meeting: { start }. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const parsed = z.object({ start: z.string().datetime() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick a time" }, { status: 400 });
  const existing = await db.meeting.findFirst({ where: { projectId: p.id, status: "BOOKED", endsAt: { gt: new Date() } } });
  try {
    const m = await bookMeeting(p, new Date(parsed.data.start), "CUSTOMER");
    if (existing) {
      await cancelMeeting(existing.id, "customer", "Rescheduled by customer");
      await db.meeting.update({ where: { id: m.id }, data: { rescheduledFromId: existing.id } });
    }
    return NextResponse.json({ ok: true, meeting: { id: m.id, startsAt: m.startsAt, designer: m.designer.name } });
  } catch (e) {
    if (e instanceof SlotTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

/** Cancel the upcoming meeting. */
export async function DELETE(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const m = await db.meeting.findFirst({ where: { projectId: p.id, status: "BOOKED", endsAt: { gt: new Date() } } });
  if (m) await cancelMeeting(m.id, "customer", "Cancelled by customer");
  return NextResponse.json({ ok: true });
}
