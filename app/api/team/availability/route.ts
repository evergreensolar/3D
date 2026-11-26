import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { istDate } from "@/lib/time";

const body = z.object({
  userId: z.string().optional(), // admin may edit others
  slotMinutes: z.number().int().min(15).max(120),
  weekly: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1440), endMinute: z.number().int().min(0).max(1440) })).max(30),
});

/** Save weekly working hours + slot length. */
export async function PUT(req: Request) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid hours" }, { status: 400 });
  const userId = parsed.data.userId && user.role === "ADMIN" ? parsed.data.userId : user.id;
  const weekly = parsed.data.weekly.filter((w) => w.endMinute > w.startMinute);
  await db.$transaction([
    db.weeklyAvailability.deleteMany({ where: { userId } }),
    db.weeklyAvailability.createMany({ data: weekly.map((w) => ({ ...w, userId })) }),
    db.user.update({ where: { id: userId }, data: { slotMinutes: parsed.data.slotMinutes } }),
  ]);
  return NextResponse.json({ ok: true });
}

/** Add leave: { date: "YYYY-MM-DD", toDate?, fromHour?, toHour?, reason? } (IST). */
export async function POST(req: Request) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = z.object({
    userId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fromHour: z.number().min(0).max(24).optional(), toHour: z.number().min(0).max(24).optional(), reason: z.string().max(200).optional(),
  }).safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "Invalid leave" }, { status: 400 });
  const userId = p.data.userId && user.role === "ADMIN" ? p.data.userId : user.id;
  const [y, m, d] = p.data.date.split("-").map(Number);
  const [y2, m2, d2] = (p.data.toDate ?? p.data.date).split("-").map(Number);
  const startsAt = istDate(y, m, d, p.data.fromHour ?? 0);
  const endsAt = istDate(y2, m2, d2, p.data.toHour ?? 24);
  if (endsAt <= startsAt) return NextResponse.json({ error: "End must be after start" }, { status: 400 });
  await db.timeOff.create({ data: { userId, startsAt, endsAt, reason: p.data.reason } });
  return NextResponse.json({ ok: true });
}
