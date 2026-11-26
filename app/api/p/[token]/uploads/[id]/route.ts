import { NextResponse } from "next/server";
import { customerProject } from "@/lib/customer";
import { saveChunk, CHUNK_BYTES } from "@/lib/chunked-upload";

export async function PUT(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const p = await customerProject(token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const index = Number(new URL(req.url).searchParams.get("index"));
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length || buf.length > CHUNK_BYTES) return NextResponse.json({ error: "Bad chunk" }, { status: 400 });
    await saveChunk(id, index, buf);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
