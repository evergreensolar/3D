import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import type { PanelTag } from "@/lib/scene/panels";
import { PanelEditor } from "@/components/PanelEditor";

export const metadata = { title: "Tag panels" };

export default async function PanelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  await requireTeamUser(["ADMIN", "DESIGNER"]);
  const { id } = await params;
  const { v } = await searchParams;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) notFound();
  const version = await db.designVersion.findFirst({
    where: { projectId: id, ...(v ? { number: Number(v) } : {}) },
    orderBy: { number: "desc" },
  });
  if (!version) notFound();
  const tags = (version.panelTags as { panels?: PanelTag[] } | null)?.panels ?? null;
  return (
    <PanelEditor
      projectId={project.id}
      projectCode={project.code}
      versionId={version.id}
      versionNumber={version.number}
      locked={!!version.lockedAt}
      modelUrl={await storage().getUrl(version.originalKey, { expiresInSec: 4 * 3600 })}
      format={version.originalFormat}
      defaultWp={project.panelWattage ?? 550}
      initialTags={tags}
    />
  );
}
