import { randomBytes } from "node:crypto";
import type { ProjectStatus, VersionStatus } from "@prisma/client";
import { db } from "@/lib/db";

export const newShareToken = () => randomBytes(24).toString("base64url");

/** EGS-2026-0001 style codes, sequential per year. */
export async function nextProjectCode() {
  const year = new Date().getFullYear();
  const prefix = `EGS-${year}-`;
  const last = await db.project.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, "0");
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  UPLOADED: "Uploaded",
  SENT_TO_CUSTOMER: "Sent to customer",
  COMMENTS_PENDING: "Comments pending",
  MEETING_BOOKED: "Meeting booked",
  REVISED: "Revised",
  APPROVED: "Approved",
};

export const STATUS_STYLE: Record<ProjectStatus, string> = {
  UPLOADED: "bg-gray-100 text-gray-700 ring-gray-200",
  SENT_TO_CUSTOMER: "bg-blue-50 text-blue-700 ring-blue-200",
  COMMENTS_PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  MEETING_BOOKED: "bg-violet-50 text-violet-700 ring-violet-200",
  REVISED: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  APPROVED: "bg-green-50 text-green-700 ring-green-200",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  QUEUED: "Waiting to process",
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Processing failed",
};

/** The version customers see: the newest READY version. */
export async function latestReadyVersion(projectId: string) {
  return db.designVersion.findFirst({ where: { projectId, status: "READY" }, orderBy: { number: "desc" } });
}

export async function logEvent(projectId: string, type: string, actor: string, data?: object) {
  await db.projectEvent.create({ data: { projectId, type, actor, data: data as never } });
}
