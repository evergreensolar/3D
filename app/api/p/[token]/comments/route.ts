import { NextResponse } from "next/server";
import { z } from "zod";
import { customerProject } from "@/lib/customer";
import { latestReadyVersion } from "@/lib/projects";
import { addComment, commentThreads } from "@/lib/comments";

const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const body = z.object({ body: z.string().trim().min(1).max(4000), anchor: z.object({ point: vec }).nullable().optional(), parentId: z.string().nullable().optional() });

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const v = await latestReadyVersion(p.id);
  return NextResponse.json({ comments: v ? await commentThreads(v.id, "You") : [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Please write your comment" }, { status: 400 });
  const v = await latestReadyVersion(p.id);
  if (!v) return NextResponse.json({ error: "No design yet" }, { status: 409 });
  if (v.lockedAt) return NextResponse.json({ error: "This design is approved; please call us for changes." }, { status: 409 });
  await addComment({ projectId: p.id, versionId: v.id, by: { customer: true }, c: parsed.data });
  return NextResponse.json({ comments: await commentThreads(v.id, "You") });
}
