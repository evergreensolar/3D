// Server side of processing: claiming a version, and turning the processor's output into the
// stored model, snapshots and PDF report. Used by the browser-processing API and by the worker.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storage, keys } from "@/lib/storage";
import { buildReportPdf, type ReportImage } from "@/lib/report/pdf";
import type { ShadingSummary } from "@/lib/scene/shading";
import { logEvent } from "@/lib/projects";
import type { SnapshotMeta } from "./types";
import { PIPELINE_VERSION } from "./version";
import type { EnergyEstimate } from "@/lib/energy/model";
import type { Layout } from "@/lib/scene/layout";
import type { PanelsFile } from "@/lib/scene/panels";

/** A version left "processing" this long (closed browser, crashed worker) can be claimed again. */
export const STALE_MS = 4 * 60_000;

/** Atomically takes a version for processing. Returns false if someone else is on it or it is done. */
export async function claimVersion(versionId: string): Promise<boolean> {
  const r = await db.designVersion.updateMany({
    where: {
      id: versionId,
      lockedAt: null,
      OR: [{ status: "QUEUED" }, { status: "PROCESSING", processingStartedAt: { lt: new Date(Date.now() - STALE_MS) } }, { status: "PROCESSING", processingStartedAt: null }],
    },
    data: { status: "PROCESSING", processingStartedAt: new Date(), processingError: null },
  });
  return r.count === 1;
}

export async function failVersion(versionId: string, error: string, log?: string, final = true) {
  await db.designVersion.update({
    where: { id: versionId },
    data: { status: final ? "FAILED" : "QUEUED", processingError: error.slice(0, 2000), processingLog: log?.slice(0, 20000), processingStartedAt: null },
  });
}

export interface FinalizeInput {
  glb?: Buffer; // converted model (DAE/ZIP uploads); GLB uploads reuse the original
  snapshots: (SnapshotMeta & { jpeg: Buffer })[];
  summary: ShadingSummary;
  energy: EnergyEstimate;
  layout: Layout;
  panelCount: number;
  totalWp: number | null;
  panelsFile: PanelsFile;
  bbox: { min: number[]; max: number[] };
  log: string[];
}

async function optimize(input: Buffer, log: string[]): Promise<Uint8Array> {
  try {
    const { NodeIO } = await import("@gltf-transform/core");
    const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
    const { dedup, prune, weld } = await import("@gltf-transform/functions");
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.readBinary(new Uint8Array(input));
    await doc.transform(dedup(), weld(), prune({ keepLeaves: true }));
    return await io.writeBinary(doc);
  } catch (e) {
    log.push(`optimise skipped: ${(e as Error).message}`);
    return input;
  }
}

export async function finalizeVersion(versionId: string, r: FinalizeInput) {
  const found = await db.designVersion.findUnique({ where: { id: versionId }, include: { project: true } });
  if (!found) throw new Error("Version not found");
  // System size and structure come from the model, not from the form.
  const project = await db.project.update({
    where: { id: found.projectId },
    data: {
      panelCount: r.panelCount,
      // Sum of each panel's rating (tagged Wp, else the project's Wp).
      systemSizeKw: r.totalWp ? Math.round(r.totalWp) / 1000 : null,
      structureHeightM: r.layout.structureHeightM,
      structureType: r.layout.structureType,
    },
  });
  const version = { ...found, project };
  const s = storage();

  const glb = await optimize(r.glb ?? (await s.get(version.originalKey)), r.log);
  const modelKey = keys.model(project.id, version.number);
  await s.put(modelKey, glb, { contentType: "model/gltf-binary" });

  const images: ReportImage[] = [];
  const snapMeta: Prisma.InputJsonValue[] = [];
  for (const snap of r.snapshots) {
    const { jpeg, ...meta } = snap;
    const key = keys.snapshot(project.id, version.number, meta.name.replace(/[^\w-]/g, ""));
    await s.put(key, jpeg, { contentType: "image/jpeg" });
    images.push({ label: meta.label, kind: meta.kind, jpeg, shadedPct: meta.shadedPct, shadedPanels: meta.shadedPanels });
    snapMeta.push({ ...meta, key });
  }

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const processedAt = new Date();
  const pdf = await buildReportPdf({
    project, version: { ...version, processedAt }, images, summary: r.summary,
    liveUrl: `${appUrl}/p/${project.shareToken}`, detectedPanelCount: r.panelCount, energy: r.energy, layout: r.layout,
  });
  const panelsKey = keys.panels(project.id, version.number);
  await s.put(panelsKey, Buffer.from(JSON.stringify(r.panelsFile)), { contentType: "application/json" });

  const reportKey = keys.report(project.id, version.number);
  await s.put(reportKey, pdf, { contentType: "application/pdf" });

  await db.designVersion.update({
    where: { id: versionId },
    data: {
      status: "READY", modelKey, panelsKey, pipelineVersion: PIPELINE_VERSION, modelBytes: glb.byteLength, reportKey, snapshots: snapMeta,
      shadingSummary: r.summary as unknown as Prisma.InputJsonValue, detectedPanelCount: r.panelCount,
      energyEstimate: r.energy as unknown as Prisma.InputJsonValue, layout: r.layout as unknown as Prisma.InputJsonValue,
      bbox: r.bbox, processedAt, processingError: null, processingLog: r.log.join("\n").slice(0, 20000),
    },
  });
  await logEvent(project.id, "version.ready", "system", { version: version.number, panels: r.panelCount, annualShadingPct: r.summary.annualPct });
}
