import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { finalizeVersion, failVersion } from "@/lib/processing/server";
import type { SnapshotMeta } from "@/lib/processing/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Browser processing, step 2: receive snapshots / summary / converted model, store them and build the PDF. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const v = await db.designVersion.findUnique({ where: { id }, select: { status: true } });
  if (v?.status !== "PROCESSING") return NextResponse.json({ error: "This version is not being processed" }, { status: 409 });
  try {
    const form = await req.formData();
    const meta = JSON.parse(String(form.get("meta"))) as {
      snapshots: SnapshotMeta[]; summary: never; panelCount: number; bbox: { min: number[]; max: number[] }; log: string[];
    };
    const snapshots = [];
    for (const s of meta.snapshots) {
      const f = form.get(`snap:${s.name}`);
      if (!(f instanceof File)) throw new Error(`Missing snapshot ${s.name}`);
      snapshots.push({ ...s, jpeg: Buffer.from(await f.arrayBuffer()) });
    }
    const glbFile = form.get("glb");
    await finalizeVersion(id, {
      glb: glbFile instanceof File ? Buffer.from(await glbFile.arrayBuffer()) : undefined,
      snapshots, summary: meta.summary, panelCount: meta.panelCount, bbox: meta.bbox,
      log: [...meta.log, `processed in browser: ${req.headers.get("user-agent")?.slice(0, 120)}`],
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failVersion(id, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
