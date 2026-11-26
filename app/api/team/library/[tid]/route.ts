import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";

/** Admin: rename, change module Wp, hide/show a template. */
export async function PATCH(req: Request, { params }: { params: Promise<{ tid: string }> }) {
  const user = await getTeamUser();
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = z.object({ name: z.string().trim().min(2).max(120).optional(), wp: z.number().int().min(50).max(1000).optional(), active: z.boolean().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  await db.structureTemplate.update({ where: { id: (await params).tid }, data: p.data });
  return NextResponse.json({ ok: true });
}
