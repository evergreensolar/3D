import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { storage, keys } from "@/lib/storage";
import { newShareToken } from "@/lib/projects";

/** Creates the demo project (sample rooftop model) owned by `userId`; it is processed like any upload. */
export async function createDemoProject(db: PrismaClient, userId: string) {
  const code = `EGS-${new Date().getFullYear()}-0001`;
  if (await db.project.findUnique({ where: { code } })) return null;
  const file = path.join(process.cwd(), "public", "samples", "sample-rooftop.glb");
  if (!existsSync(file)) return null;
  const p = await db.project.create({
    data: {
      code,
      customerSalutation: "MR",
      customerName: "Amit Roy (Demo)",
      customerMobile: "+919800000001",
      customerEmail: null,
      address: "12/3 Lake View Road, Salt Lake Sector II, Kolkata 700091, West Bengal",
      latitude: 22.5806,
      longitude: 88.4166,
      panelMake: "Waaree",
      panelModel: "Bi-55-550 Mono PERC",
      panelWattage: 550,
      shareToken: newShareToken(),
      designerId: userId,
      createdById: userId,
    },
  });
  const buf = readFileSync(file);
  const key = keys.original(p.id, 1, "glb");
  await storage().put(key, buf, { contentType: "model/gltf-binary" });
  const v = await db.designVersion.create({
    data: { projectId: p.id, number: 1, originalKey: key, originalFormat: "GLB", originalFilename: "sample-rooftop.glb", originalBytes: buf.length, uploadedById: userId },
  });
  await db.job.create({ data: { type: "process_version", payload: { versionId: v.id } } });
  return p;
}
