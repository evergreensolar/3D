import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { claimVersion } from "@/lib/processing/server";

/** Browser processing, step 1: claim the version and get what the processor needs. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!(await claimVersion(id))) return NextResponse.json({ claimed: false });
  const v = await db.designVersion.findUnique({ where: { id }, include: { project: true } });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    claimed: true,
    input: {
      modelUrl: await storage().getUrl(v.originalKey, { expiresInSec: 1800 }),
      format: v.originalFormat,
      lat: v.project.latitude,
      lng: v.project.longitude,
      northOffsetDeg: v.project.northOffsetDeg,
      tags: (v.panelTags as { panels?: unknown[] } | null)?.panels ?? null,
      defaultWp: v.project.panelWattage,
    },
  });
}
