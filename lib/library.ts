import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import type { TemplateMeta } from "@/lib/design/types";

/** Active library templates with signed URLs for the model and thumbnail. */
export async function listTemplates(includeInactive = false): Promise<(TemplateMeta & { description: string | null; active: boolean })[]> {
  const rows = await db.structureTemplate.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { createdAt: "desc" } });
  return Promise.all(rows.map(async (t) => ({
    ...(t.meta as unknown as TemplateMeta),
    id: t.id, name: t.name, wp: t.wp, panelCount: t.panelCount, description: t.description, active: t.active,
    modelUrl: await storage().getUrl(t.modelKey, { expiresInSec: 6 * 3600 }),
    thumbUrl: t.thumbKey ? await storage().getUrl(t.thumbKey, { expiresInSec: 6 * 3600 }) : undefined,
  })));
}
