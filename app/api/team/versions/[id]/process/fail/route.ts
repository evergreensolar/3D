import { NextResponse } from "next/server";
import { getTeamUser } from "@/lib/auth/session";
import { failVersion } from "@/lib/processing/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { error, log } = (await req.json().catch(() => ({}))) as { error?: string; log?: string[] };
  await failVersion(id, error || "Processing failed in the browser", log?.join("\n"));
  return NextResponse.json({ ok: true });
}
