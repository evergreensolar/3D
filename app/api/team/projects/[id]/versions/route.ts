import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { assembleUpload } from "@/lib/chunked-upload";
import { storage, keys } from "@/lib/storage";
import { enqueue } from "@/lib/jobs";
import { logEvent } from "@/lib/projects";
import { sniffModelFormat, FORMAT_EXT, FORMAT_MIME, MAX_MODEL_BYTES } from "@/lib/upload";

export const runtime = "nodejs";

const body = z.object({
  uploadId: z.string(),
  chunks: z.number().int().min(1).max(200),
  filename: z.string().max(200),
  changeNotes: z.string().max(2000).optional(),
  // present when the model was designed in the Design Studio
  design: z.record(z.string(), z.unknown()).optional(),
});

/** Adds a new design version (Version N+1) from a chunked upload — a revised SketchUp export or a Studio design. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Only designers and admins can add designs" }, { status: 403 });
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const d = parsed.data;
  const project = await db.project.findUnique({ where: { id }, include: { versions: { orderBy: { number: "desc" }, take: 1 } } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.status === "APPROVED") return NextResponse.json({ error: "This project is approved" }, { status: 409 });
  try {
    const buf = await assembleUpload(d.uploadId, d.chunks);
    if (buf.length > MAX_MODEL_BYTES) return NextResponse.json({ error: "Model is larger than 300 MB" }, { status: 400 });
    const format = sniffModelFormat(buf);
    if (!format) return NextResponse.json({ error: "Unsupported file. Upload a .glb, .dae, or a .zip with the .dae and its textures." }, { status: 400 });
    const number = (project.versions[0]?.number ?? 0) + 1;
    const key = keys.original(project.id, number, FORMAT_EXT[format]);
    await storage().put(key, buf, { contentType: FORMAT_MIME[format] });
    const studio = !!d.design;
    const v = await db.designVersion.create({
      data: {
        projectId: project.id, number, originalKey: key, originalFormat: format, originalFilename: d.filename.slice(0, 200),
        originalBytes: buf.length, uploadedById: user.id, changeNotes: d.changeNotes,
        source: studio ? "studio" : "upload", designJson: studio ? (d.design as Prisma.InputJsonValue) : undefined,
      },
    });
    if (studio) {
      // Studio models are drawn north-up at the site; take the panel rating from the design.
      const wp = Number((d.design as { array?: { wp?: unknown } }).array?.wp);
      await db.project.update({ where: { id }, data: { northOffsetDeg: 0, ...(wp >= 50 && wp <= 1000 ? { panelWattage: Math.round(wp) } : {}) } });
    }
    if (number > 1 && project.status !== "UPLOADED") await db.project.update({ where: { id }, data: { status: "REVISED" } });
    await enqueue("process_version", { versionId: v.id });
    await logEvent(project.id, "version.uploaded", `user:${user.id}`, { version: number, source: v.source, filename: d.filename });
    return NextResponse.json({ id: v.id, number });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
