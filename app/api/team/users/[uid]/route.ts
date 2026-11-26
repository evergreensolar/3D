import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

/** Admin: change role, (de)activate, reset password. Anyone: change own password. */
export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { uid } = await params;
  if (user.role !== "ADMIN" && uid !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = z.object({ role: z.enum(["ADMIN", "DESIGNER", "SALES"]).optional(), active: z.boolean().optional(), password: z.string().min(8).max(100).optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  if (uid === user.id && (p.data.active === false || (p.data.role && p.data.role !== "ADMIN" && user.role === "ADMIN"))) {
    return NextResponse.json({ error: "You cannot deactivate or demote yourself" }, { status: 400 });
  }
  await db.user.update({
    where: { id: uid },
    data: {
      ...(user.role === "ADMIN" && p.data.role ? { role: p.data.role } : {}),
      ...(user.role === "ADMIN" && p.data.active !== undefined ? { active: p.data.active } : {}),
      ...(p.data.password ? { passwordHash: await hashPassword(p.data.password) } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
