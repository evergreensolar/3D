// Video + OTP design approval with a tamper-evident record.
import { createHash } from "node:crypto";
import type { Approval, DesignVersion, Project } from "@prisma/client";

export function consentText(p: Pick<Project, "customerName" | "address">, versionNumber: number) {
  return `I, ${p.customerName.trim()}, have reviewed design Version ${versionNumber} for ${p.address.trim().replace(/\s+/g, " ")}. Please install the system exactly as shown.`;
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Detects the recorded video container from its bytes. */
export function sniffVideo(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: "video/webm", ext: "webm" };
  if (buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") return { mime: "video/mp4", ext: "mp4" };
  return null;
}

type RecordFields = Pick<Approval, "projectId" | "versionId" | "versionNumber" | "customerName" | "customerMobile" | "consentText" | "videoSha256" | "videoBytes" | "videoMime" | "otpChallengeId" | "ip" | "userAgent"> & { approvedAt: Date };

const HASHED: (keyof RecordFields)[] = [
  "approvedAt", "consentText", "customerMobile", "customerName", "ip", "otpChallengeId", "projectId",
  "userAgent", "versionId", "versionNumber", "videoBytes", "videoMime", "videoSha256",
];

/** SHA-256 over the canonical (fixed key order) JSON of the record — any later edit changes it. */
export function recordHash(r: RecordFields) {
  const canonical = Object.fromEntries(HASHED.map((k) => [k, k === "approvedAt" ? r.approvedAt.toISOString() : r[k] ?? null]));
  return sha256(JSON.stringify(canonical));
}

export function verifyRecord(a: Approval) {
  return recordHash(a) === a.recordHash;
}

export type ApprovalTarget = Project & { version: DesignVersion };
