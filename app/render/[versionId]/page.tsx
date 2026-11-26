// Headless processing page, opened only by the worker (signed URL). It loads the SketchUp
// export, converts DAE→GLB, detects panels, computes the yearly shading summary and renders
// the report snapshots, using exactly the same scene code as the customer viewer.
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { verify } from "@/lib/storage/sign";
import { Processor } from "./Processor";

export const dynamic = "force-dynamic";

export default async function RenderPage({ params, searchParams }: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ exp?: string; sig?: string }>;
}) {
  const { versionId } = await params;
  const { exp, sig } = await searchParams;
  if (!verify(`render:${versionId}`, Number(exp), sig ?? "")) notFound();
  const v = await db.designVersion.findUnique({ where: { id: versionId }, include: { project: true } });
  if (!v) notFound();
  const url = await storage().getUrl(v.originalKey, { expiresInSec: 1800 });
  return (
    <Processor
      modelUrl={url}
      format={v.originalFormat}
      lat={v.project.latitude}
      lng={v.project.longitude}
      northOffsetDeg={v.project.northOffsetDeg}
      tags={(v.panelTags as { panels?: never[] } | null)?.panels ?? null}
      defaultWp={v.project.panelWattage}
    />
  );
}
