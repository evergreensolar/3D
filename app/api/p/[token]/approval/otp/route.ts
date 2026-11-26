import { NextResponse } from "next/server";
import { customerProject } from "@/lib/customer";
import { sendOtp } from "@/lib/auth/otp";
import { clientMeta } from "@/lib/request";

/** OTP that confirms the design approval (separate from the login OTP). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const { channel } = (await req.json().catch(() => ({}))) as { channel?: string };
  const r = await sendOtp(p, "APPROVAL", channel === "WHATSAPP" ? "WHATSAPP" : "SMS", clientMeta(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 429 });
}
