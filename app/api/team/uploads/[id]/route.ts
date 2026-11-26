import { NextResponse } from "next/server";
import { getTeamUser } from "@/lib/auth/session";
import { saveChunk, CHUNK_BYTES } from "@/lib/chunked-upload";

export const runtime = "nodejs";

/** Receives one chunk: PUT /api/team/uploads/<id>?index=N with the raw bytes as body. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const index = Number(new URL(req.url).searchParams.get("index"));
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > CHUNK_BYTES) return NextResponse.json({ error: "Bad chunk size" }, { status: 400 });
    await saveChunk(id, index, buf);
    return NextResponse.json({ ok: true, bytes: buf.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
