import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { projectSchema } from "@/lib/validation";
import { enqueue } from "@/lib/jobs";
import { logEvent } from "@/lib/projects";

/** Update project details; re-processes the latest unlocked version so shading and PDF match. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user || user.role === "SALES") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const form = await req.formData();
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = projectSchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please fix the highlighted fields", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const d = parsed.data;
  const project = await db.project.update({
    where: { id },
    data: {
      customerSalutation: d.customerSalutation, customerName: d.customerName, customerMobile: d.customerMobile,
      customerEmail: d.customerEmail || null, address: d.address, latitude: d.latitude, longitude: d.longitude,
      northOffsetDeg: d.northOffsetDeg, systemSizeKw: d.systemSizeKw, panelCount: d.panelCount, panelMake: d.panelMake,
      panelModel: d.panelModel, panelWattage: d.panelWattage ?? null, structureHeightM: d.structureHeightM,
      structureType: d.structureType, designerId: d.designerId || null,
    },
  });
  const latest = await db.designVersion.findFirst({ where: { projectId: id }, orderBy: { number: "desc" } });
  if (latest && !latest.lockedAt) {
    await db.designVersion.update({ where: { id: latest.id }, data: { status: "QUEUED" } });
    await enqueue("process_version", { versionId: latest.id });
  }
  await logEvent(project.id, "project.updated", `user:${user.id}`);
  return NextResponse.json({ ok: true });
}
