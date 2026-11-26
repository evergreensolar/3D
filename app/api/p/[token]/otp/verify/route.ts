import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyOtp } from "@/lib/auth/otp";
import { startCustomerSession } from "@/lib/auth/session";
import { logEvent } from "@/lib/projects";
import { clientMeta } from "@/lib/request";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await db.project.findUnique({ where: { shareToken: token } });
  if (!project) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const r = await verifyOtp(project, "VIEW_ACCESS", String(code ?? ""));
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  await startCustomerSession(project.id, project.customerMobile);
  await logEvent(project.id, "customer.verified", "customer", clientMeta(req));
  return NextResponse.json({ ok: true });
}
