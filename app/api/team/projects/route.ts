import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { projectSchema } from "@/lib/validation";
import { newShareToken, nextProjectCode, logEvent } from "@/lib/projects";
import { storage, keys } from "@/lib/storage";
import { enqueue } from "@/lib/jobs";
import { assembleUpload } from "@/lib/chunked-upload";
import { sniffModelFormat, FORMAT_EXT, FORMAT_MIME, MAX_MODEL_BYTES } from "@/lib/upload";

export const runtime = "nodejs";

/** Create a project + Version 1 from a SketchUp export (multipart form). */
export async function POST(req: Request) {
  try {
    return await createProject(req);
  } catch (e) {
    console.error("[upload] failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Upload could not be saved: ${msg.split("\n").filter(Boolean).pop()?.slice(0, 300)}` }, { status: 500 });
  }
}

async function createProject(req: Request) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Only designers and admins can upload designs" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The upload was interrupted or is too large for the server. Please try again." }, { status: 413 });
  }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = projectSchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fix the highlighted fields", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  // The model arrives either in chunks (uploadId, preferred) or as a plain file field.
  const file = form.get("model");
  const uploadId = form.get("uploadId");
  let buf: Buffer;
  let filename: string;
  if (typeof uploadId === "string" && uploadId) {
    buf = await assembleUpload(uploadId, Number(form.get("chunks")));
    filename = String(form.get("filename") || "model");
  } else if (file instanceof File && file.size > 0) {
    buf = Buffer.from(await file.arrayBuffer());
    filename = file.name;
  } else if (form.get("designInPortal") === "1") {
    return createWithoutModel(user, parsed.data);
  } else {
    return NextResponse.json({ error: "Choose the model file exported from SketchUp" }, { status: 400 });
  }
  if (buf.length > MAX_MODEL_BYTES) return NextResponse.json({ error: "Model is larger than 300 MB" }, { status: 400 });

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
        data: { projectId: p.id, number: 1, originalKey: key, originalFormat: format, originalFilename: filename.slice(0, 200), originalBytes: buf.length, uploadedById: user.id },
      });
      await enqueue("process_version", { versionId: v.id });
      await logEvent(p.id, "version.uploaded", `user:${user.id}`, { version: 1, filename });
      return NextResponse.json({ id: p.id, code: p.code });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}

/** "Design in portal": create the project only; the Design Studio adds Version 1 on save. */
async function createWithoutModel(user: { id: string; role: string }, d: import("@/lib/validation").ProjectInput) {
  for (let attempt = 0; ; attempt++) {
    try {
      const p = await db.project.create({
        data: {
          code: await nextProjectCode(),
          customerSalutation: d.customerSalutation, customerName: d.customerName, customerMobile: d.customerMobile,
          customerEmail: d.customerEmail || null, address: d.address, latitude: d.latitude, longitude: d.longitude,
          northOffsetDeg: 0, panelMake: d.panelMake || null, panelModel: d.panelModel || null, panelWattage: d.panelWattage,
          shareToken: newShareToken(), designerId: d.designerId || (user.role === "DESIGNER" ? user.id : null), createdById: user.id,
        },
      });
      await logEvent(p.id, "project.created", `user:${user.id}`, { designInPortal: true });
      return NextResponse.json({ id: p.id, code: p.code, design: true });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}
