import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { bookMeeting, freeSlots, SlotTakenError } from "@/lib/meetings";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = await db.project.findUnique({ where: { id: (await params).id } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const slots = await freeSlots(p);
  return NextResponse.json({ slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) });
}

/** Team books a meeting on the customer's behalf: { start }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = await db.project.findUnique({ where: { id: (await params).id }, include: { designer: true } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = z.object({ start: z.string().datetime() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick a time" }, { status: 400 });
  try {
    const m = await bookMeeting(p, new Date(parsed.data.start), "TEAM");
    return NextResponse.json({ ok: true, id: m.id });
  } catch (e) {
    if (e instanceof SlotTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
