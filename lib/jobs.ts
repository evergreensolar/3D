import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type JobType = "process_version" | "meeting_reminder";

export async function enqueue(type: JobType, payload: Prisma.InputJsonValue, runAfter = new Date()) {
  return db.job.create({ data: { type, payload, runAfter } });
}
