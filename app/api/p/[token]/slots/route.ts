import { NextResponse } from "next/server";
import { customerProject } from "@/lib/customer";
import { freeSlots } from "@/lib/meetings";

/** Free meeting slots for the next 14 days (times only — designers are assigned on booking). */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const slots = await freeSlots(p);
  return NextResponse.json({ slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) });
}
