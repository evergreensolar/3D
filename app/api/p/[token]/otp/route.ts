import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendOtp } from "@/lib/auth/otp";
import { clientMeta } from "@/lib/request";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await db.project.findUnique({ where: { shareToken: token } });
  if (!project) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { channel?: string };
  const channel = body.channel === "WHATSAPP" ? "WHATSAPP" : "SMS";
  const r = await sendOtp(project, "VIEW_ACCESS", channel, clientMeta(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 429 });
}
