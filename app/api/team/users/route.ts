import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

/** Admin: add a team member (designers get the default Mon–Sat 11:00–19:00 hours). */
export async function POST(req: Request) {
  const user = await getTeamUser();
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Only admins can add team members" }, { status: 403 });
  const p = z.object({
    name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), phone: z.string().max(20).optional(),
    role: z.enum(["ADMIN", "DESIGNER", "SALES"]), password: z.string().min(8).max(100),
  }).safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Invalid details" }, { status: 400 });
  if (await db.user.findUnique({ where: { email: p.data.email } })) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
  const u = await db.user.create({ data: { name: p.data.name, email: p.data.email, phone: p.data.phone, role: p.data.role, passwordHash: await hashPassword(p.data.password) } });
  if (u.role !== "SALES") {
    await db.weeklyAvailability.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ userId: u.id, weekday, startMinute: 660, endMinute: 1140 })) });
  }
  return NextResponse.json({ ok: true, id: u.id });
}
