import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getTeamUser } from "@/lib/auth/session";
import { startUpload, CHUNK_BYTES } from "@/lib/chunked-upload";

export const runtime = "nodejs";

/** Starts a chunked upload. */
export async function POST() {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "SALES") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = randomUUID();
  await startUpload(id);
  return NextResponse.json({ id, chunkBytes: CHUNK_BYTES });
}
