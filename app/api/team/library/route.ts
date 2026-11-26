import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { assembleUpload } from "@/lib/chunked-upload";
import { storage } from "@/lib/storage";
import { sniffModelFormat } from "@/lib/upload";
import { listTemplates } from "@/lib/library";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ templates: await listTemplates() });
}

const num = z.number().finite();
const body = z.object({
  uploadId: z.string(), chunks: z.number().int().min(1).max(60),
  name: z.string().trim().min(2).max(120), description: z.string().max(1000).optional(),
  wp: z.number().int().min(50).max(1000),
  meta: z.object({
    panelCount: z.number().int().min(1).max(500), w: num, d: num, h: num, cx: num, cz: num, minY: num,
    modules: z.array(z.object({ x: num, z: num, w: num, d: num })).max(500),
    panelPaths: z.array(z.string().regex(/^\d+(\.\d+)*$/)).max(500),
  }),
  thumb: z.string().startsWith("data:image/").max(2_000_000).optional(),
});

/** Admin: add a structure-with-modules model to the library. */
export async function POST(req: Request) {
  const user = await getTeamUser();
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Only admins can manage the structure library" }, { status: 403 });
  const p = body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Invalid data" }, { status: 400 });
  const d = p.data;
  const glb = await assembleUpload(d.uploadId, d.chunks).catch((e) => e as Error);
  if (glb instanceof Error) return NextResponse.json({ error: glb.message }, { status: 400 });
  if (sniffModelFormat(glb) !== "GLB") return NextResponse.json({ error: "Upload a .glb file" }, { status: 400 });
  const t = await db.structureTemplate.create({
    data: { name: d.name, description: d.description, wp: d.wp, panelCount: d.meta.panelCount, meta: d.meta as Prisma.InputJsonValue, modelKey: "", createdById: user.id },
  });
  const modelKey = `library/${t.id}/model.glb`;
  await storage().put(modelKey, glb, { contentType: "model/gltf-binary" });
  let thumbKey: string | undefined;
  if (d.thumb) {
    thumbKey = `library/${t.id}/thumb.png`;
    await storage().put(thumbKey, Buffer.from(d.thumb.split(",")[1], "base64"), { contentType: "image/png" });
  }
  await db.structureTemplate.update({ where: { id: t.id }, data: { modelKey, thumbKey } });
  return NextResponse.json({ ok: true, id: t.id });
}
