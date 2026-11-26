import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { customerProject } from "@/lib/customer";
import { startUpload, CHUNK_BYTES } from "@/lib/chunked-upload";

/** Starts a chunked upload of the approval video. */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const id = randomUUID();
  await startUpload(id);
  return NextResponse.json({ id, chunkBytes: CHUNK_BYTES });
}
