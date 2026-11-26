import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTeamUser } from "@/lib/auth/session";
import { addComment, commentThreads } from "@/lib/comments";
import { addressCustomer } from "@/lib/notify/address";

const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const body = z.object({ versionId: z.string(), body: z.string().trim().min(1).max(4000), anchor: z.object({ point: vec }).nullable().optional(), parentId: z.string().nullable().optional() });

async function threads(projectId: string, versionId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  return commentThreads(versionId, addressCustomer(p));
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getTeamUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const versionId = new URL(req.url).searchParams.get("versionId");
  if (!versionId) return NextResponse.json({ comments: [] });
  return NextResponse.json({ comments: await threads(id, versionId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getTeamUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Write a message" }, { status: 400 });
  const v = await db.designVersion.findFirst({ where: { id: parsed.data.versionId, projectId: id } });
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  await addComment({ projectId: id, versionId: v.id, by: { userId: user.id }, c: parsed.data });
  return NextResponse.json({ comments: await threads(id, v.id) });
}
