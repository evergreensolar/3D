import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { OtpPurpose, Project } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { dispatch } from "@/lib/notify";
import { templates } from "@/lib/notify/templates";

export const OTP_TTL_MIN = 10;
const RESEND_COOLDOWN_SEC = 45;
const MAX_PER_HOUR = 6;
const MAX_ATTEMPTS = 5;

const hash = (id: string, code: string) => createHmac("sha256", env.sessionSecret).update(`${id}:${code}`).digest("hex");

export type SendOtpResult =
  | { ok: true; resendInSec: number; devCode?: string; channel: "SMS" | "WHATSAPP" }
  | { ok: false; error: string; retryInSec?: number };

export async function sendOtp(project: Project, purpose: OtpPurpose, channel: "SMS" | "WHATSAPP", meta: { ip?: string; userAgent?: string }): Promise<SendOtpResult> {
  const recent = await db.otpChallenge.findMany({
    where: { projectId: project.id, purpose, createdAt: { gt: new Date(Date.now() - 3600_000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent[0]) {
    const wait = RESEND_COOLDOWN_SEC - Math.floor((Date.now() - recent[0].createdAt.getTime()) / 1000);
    if (wait > 0) return { ok: false, error: `Please wait ${wait} seconds before requesting another code.`, retryInSec: wait };
  }
  if (recent.length >= MAX_PER_HOUR) return { ok: false, error: "Too many codes requested. Please try again in an hour." };

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.otpChallenge.create({
    data: {
      id, projectId: project.id, mobile: project.customerMobile, purpose, codeHash: hash(id, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400),
    },
  });
  const [r] = await dispatch({
    projectId: project.id,
    template: "otp",
    rendered: templates.otp(project, { code, minutes: OTP_TTL_MIN }),
    channels: [channel],
    to: { mobile: project.customerMobile },
    vars: { code },
  });
  if (r && !r.ok) return { ok: false, error: "We could not send the code right now. Please try again shortly." };
  return { ok: true, resendInSec: RESEND_COOLDOWN_SEC, channel, devCode: env.devShowOtp ? code : undefined };
}

export type VerifyOtpResult = { ok: true; challengeId: string } | { ok: false; error: string };

export async function verifyOtp(project: Project, purpose: OtpPurpose, code: string): Promise<VerifyOtpResult> {
  const c = await db.otpChallenge.findFirst({
    where: { projectId: project.id, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!c || c.expiresAt < new Date()) return { ok: false, error: "The code has expired. Please request a new one." };
  if (c.mobile !== project.customerMobile) return { ok: false, error: "Please request a new code." };
  if (c.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong attempts. Please request a new code." };
  await db.otpChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
  const a = Buffer.from(hash(c.id, code.trim()));
  const b = Buffer.from(c.codeHash);
  if (!/^\d{6}$/.test(code.trim()) || a.length !== b.length || !timingSafeEqual(a, b)) {
    const left = MAX_ATTEMPTS - c.attempts - 1;
    return { ok: false, error: left > 0 ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Please request a new code." };
  }
  // Single use, guarded against a concurrent double-submit.
  const used = await db.otpChallenge.updateMany({ where: { id: c.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (used.count !== 1) return { ok: false, error: "This code was already used. Please request a new one." };
  return { ok: true, challengeId: c.id };
}
