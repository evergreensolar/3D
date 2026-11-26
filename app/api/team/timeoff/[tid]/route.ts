import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";

export async function DELETE(_: Request, { params }: { params: Promise<{ tid: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { tid } = await params;
  await db.timeOff.deleteMany({ where: { id: tid, ...(user.role === "ADMIN" ? {} : { userId: user.id }) } });
  return NextResponse.json({ ok: true });
}
