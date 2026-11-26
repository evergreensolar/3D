import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { customerProject } from "@/lib/customer";
import { verifyOtp } from "@/lib/auth/otp";
import { assembleUpload } from "@/lib/chunked-upload";
import { consentText, recordHash, sha256, sniffVideo } from "@/lib/approval";
import { latestReadyVersion, logEvent } from "@/lib/projects";
import { storage } from "@/lib/storage";
import { clientMeta } from "@/lib/request";
import { dispatch } from "@/lib/notify";
import { templates } from "@/lib/notify/templates";

export const runtime = "nodejs";
export const maxDuration = 120;

const body = z.object({
  versionId: z.string(),
  uploadId: z.string(),
  chunks: z.number().int().min(1).max(60),
  code: z.string().regex(/^\d{6}$/),
  device: z.record(z.string(), z.unknown()).optional(),
});

/** Records the customer's video + OTP approval of the current design version and locks it. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await customerProject((await params).token);
  if (!p) return NextResponse.json({ error: "Please verify your mobile number first" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Please record the video and enter the code" }, { status: 400 });
  const d = parsed.data;
  const v = await latestReadyVersion(p.id);
  if (!v || v.id !== d.versionId) return NextResponse.json({ error: "A newer design version is available — please review it first." }, { status: 409 });
  if (v.lockedAt) return NextResponse.json({ error: "This design version is already approved." }, { status: 409 });

  const otp = await verifyOtp(p, "APPROVAL", d.code);
  if (!otp.ok) return NextResponse.json({ error: otp.error }, { status: 400 });

  let video: Buffer;
  try { video = await assembleUpload(d.uploadId, d.chunks); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const kind = sniffVideo(video);
  if (!kind || video.length < 20_000) return NextResponse.json({ error: "The video could not be read. Please record again." }, { status: 400 });

  const meta = clientMeta(req);
  const approvedAt = new Date();
  const videoSha256 = sha256(video);
  const key = `projects/${p.id}/v${v.number}/approval-${approvedAt.getTime()}.${kind.ext}`;
  await storage().put(key, video, { contentType: kind.mime });

  const fields = {
    projectId: p.id, versionId: v.id, versionNumber: v.number, customerName: p.customerName, customerMobile: p.customerMobile,
    consentText: consentText(p, v.number), videoSha256, videoBytes: video.length, videoMime: kind.mime,
    otpChallengeId: otp.challengeId, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 500) ?? null, approvedAt,
  };
  const approval = await db.$transaction(async (tx) => {
    const locked = await tx.designVersion.updateMany({ where: { id: v.id, lockedAt: null }, data: { lockedAt: approvedAt } });
    if (!locked.count) throw new Error("already approved");
    const a = await tx.approval.create({
      data: { ...fields, videoKey: key, recordHash: recordHash(fields), deviceInfo: (d.device ?? {}) as Prisma.InputJsonValue },
    });
    await tx.project.update({ where: { id: p.id }, data: { status: "APPROVED" } });
    return a;
  });
  await logEvent(p.id, "design.approved", "customer", { version: v.number, sha256: videoSha256 });
  await dispatch({
    projectId: p.id, template: "approved", channels: ["WHATSAPP", "SMS", ...(p.customerEmail ? (["EMAIL"] as const) : [])],
    rendered: templates.approved(p, { projectCode: p.code, version: v.number }), to: { mobile: p.customerMobile, email: p.customerEmail },
  });
  if (p.designer?.email) {
    await dispatch({
      projectId: p.id, template: "approved_team", channels: ["EMAIL"], to: { email: p.designer.email },
      rendered: { subject: `APPROVED: ${p.code} Version ${v.number}`, text: `${p.customerName} approved design Version ${v.number} of ${p.code} by video and OTP at ${approvedAt.toISOString()}.`, params: [] },
    });
  }
  return NextResponse.json({ ok: true, approvalId: approval.id, sha256: videoSha256 });
}
