// Seed: team accounts + one demo project using the sample GLB.
//   npm run db:seed
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { storage, keys } from "@/lib/storage";
import { newShareToken } from "@/lib/projects";

const PASSWORD = "evergreen123";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const users = [
    { name: "Admin", email: "admin@evergreen.test", role: "ADMIN" as const },
    { name: "Ananya Sen (Designer)", email: "designer@evergreen.test", role: "DESIGNER" as const },
    { name: "Rahul Ghosh (Designer)", email: "designer2@evergreen.test", role: "DESIGNER" as const },
    { name: "Priya Banerjee (Sales)", email: "sales@evergreen.test", role: "SALES" as const },
  ];
  const created = [];
  for (const u of users) {
    created.push(await db.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash: hash } }));
  }
  const designer = created[1];

  // Default weekly availability (Mon–Sat 11:00–19:00 IST) for designers — used from Phase 2.
  for (const u of created.filter((x) => x.role === "DESIGNER")) {
    if (await db.weeklyAvailability.count({ where: { userId: u.id } })) continue;
    await db.weeklyAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ userId: u.id, weekday, startMinute: 11 * 60, endMinute: 19 * 60 })),
    });
  }

  if (!(await db.project.findUnique({ where: { code: "EGS-2026-0001" } }))) {
    const p = await db.project.create({
      data: {
        code: "EGS-2026-0001",
        customerSalutation: "MR",
        customerName: "Amit Roy",
        customerMobile: "+919800000001",
        customerEmail: "amit.roy@example.com",
        address: "12/3 Lake View Road, Salt Lake Sector II, Kolkata 700091, West Bengal",
        latitude: 22.5806,
        longitude: 88.4166,
        northOffsetDeg: 0,
        systemSizeKw: 6.6,
        panelCount: 12,
        panelMake: "Waaree",
        panelModel: "Bi-55-550 Mono PERC",
        panelWattage: 550,
        structureHeightM: 2.1,
        structureType: "Elevated GI structure",
        shareToken: newShareToken(),
        designerId: designer.id,
        createdById: designer.id,
      },
    });
    const buf = readFileSync("public/samples/sample-rooftop.glb");
    const key = keys.original(p.id, 1, "glb");
    await storage().put(key, buf, { contentType: "model/gltf-binary" });
    const v = await db.designVersion.create({
      data: { projectId: p.id, number: 1, originalKey: key, originalFormat: "GLB", originalFilename: "sample-rooftop.glb", originalBytes: buf.length, uploadedById: designer.id },
    });
    await db.job.create({ data: { type: "process_version", payload: { versionId: v.id } } });
    console.log(`Demo project ${p.code}: customer link /p/${p.shareToken}`);
  }
  console.log(`Seeded ${created.length} users. Password for all: ${PASSWORD}`);
  for (const u of created) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
}

main().finally(() => db.$disconnect());
