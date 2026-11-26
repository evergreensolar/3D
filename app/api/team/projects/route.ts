import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { projectSchema } from "@/lib/validation";
import { newShareToken, nextProjectCode, logEvent } from "@/lib/projects";
import { storage, keys } from "@/lib/storage";
import { enqueue } from "@/lib/jobs";
import { sniffModelFormat, FORMAT_EXT, FORMAT_MIME, MAX_MODEL_BYTES } from "@/lib/upload";

export const runtime = "nodejs";

/** Create a project + Version 1 from a SketchUp export (multipart form). */
export async function POST(req: Request) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Only designers and admins can upload designs" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("model");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose the model file exported from SketchUp" }, { status: 400 });
  if (file.size > MAX_MODEL_BYTES) return NextResponse.json({ error: "Model is larger than 300 MB" }, { status: 400 });

  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = projectSchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fix the highlighted fields", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const format = sniffModelFormat(buf);
  if (!format) return NextResponse.json({ error: "Unsupported file. Upload a .glb, .dae, or a .zip with the .dae and its textures." }, { status: 400 });

  const d = parsed.data;
  const designerId = d.designerId || (user.role === "DESIGNER" ? user.id : null);

  // Retry on the (rare) project-code race.
  for (let attempt = 0; ; attempt++) {
    try {
      const p = await db.project.create({
          data: {
            code: await nextProjectCode(),
            customerSalutation: d.customerSalutation,
            customerName: d.customerName,
            customerMobile: d.customerMobile,
            customerEmail: d.customerEmail || null,
            address: d.address,
            latitude: d.latitude,
            longitude: d.longitude,
            northOffsetDeg: d.northOffsetDeg,
            panelMake: d.panelMake || null,
            panelModel: d.panelModel || null,
            panelWattage: d.panelWattage,
            shareToken: newShareToken(),
            designerId,
            createdById: user.id,
          },
        });
      const key = keys.original(p.id, 1, FORMAT_EXT[format]);
      try {
        await storage().put(key, buf, { contentType: FORMAT_MIME[format] });
      } catch (err) {
        await db.project.delete({ where: { id: p.id } });
        throw err;
      }
      const v = await db.designVersion.create({
        data: { projectId: p.id, number: 1, originalKey: key, originalFormat: format, originalFilename: file.name.slice(0, 200), originalBytes: buf.length, uploadedById: user.id },
      });
      await enqueue("process_version", { versionId: v.id });
      await logEvent(p.id, "version.uploaded", `user:${user.id}`, { version: 1, filename: file.name });
      return NextResponse.json({ id: p.id, code: p.code });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}
