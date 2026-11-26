import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { enqueue } from "@/lib/jobs";
import { logEvent } from "@/lib/projects";

const body = z.object({
  // null = go back to automatic detection
  tags: z.array(z.object({
    path: z.string().regex(/^\d+(\.\d+)*$/),
    wp: z.number().int().min(50).max(1000),
    name: z.string().max(200).optional(),
  })).max(20000).nullable(),
});

/** Saves the designer's panel tags and re-processes the version. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Only designers and admins can tag panels" }, { status: 403 });
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid panel data" }, { status: 400 });
  const v = await db.designVersion.findUnique({ where: { id } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (v.lockedAt) return NextResponse.json({ error: "This version is approved and locked" }, { status: 409 });
  const tags = parsed.data.tags;
  await db.designVersion.update({
    where: { id },
    data: {
      panelTags: tags ? ({ panels: tags, updatedAt: new Date().toISOString(), by: user.id } as Prisma.InputJsonValue) : ({} as Prisma.InputJsonValue),
      status: "QUEUED",
      processingError: null,
    },
  });
  await enqueue("process_version", { versionId: id });
  await logEvent(v.projectId, "panels.tagged", `user:${user.id}`, {
    version: v.number, panels: tags?.length ?? "auto", kwp: tags ? tags.reduce((s, t) => s + t.wp, 0) / 1000 : undefined,
  });
  return NextResponse.json({ ok: true });
}
