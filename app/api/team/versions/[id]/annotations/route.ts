import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";

const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const body = z.object({ items: z.array(z.object({ a: vec, b: vec, label: z.string().max(80).optional() })).max(100) });

/** Saves the dimension lines the team wants the customer to see on this version. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid measurements" }, { status: 400 });
  const v = await db.designVersion.findUnique({ where: { id }, select: { id: true } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.designVersion.update({ where: { id }, data: { annotations: parsed.data.items } });
  return NextResponse.json({ ok: true });
}
