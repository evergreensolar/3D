// In-process scheduler for time-based jobs (meeting reminders). Runs inside the web server, so it
// works on hosts without a separate worker process (e.g. Hostinger). Model processing jobs are left
// to the designer's browser or the optional worker.
import { db } from "@/lib/db";
import { runMeetingReminder } from "@/lib/meetings";

const TYPES = ["meeting_reminder"];
const g = globalThis as unknown as { __evgScheduler?: ReturnType<typeof setInterval> };

export async function runDueJobs() {
  const due = await db.job.findMany({ where: { type: { in: TYPES }, status: "PENDING", runAfter: { lte: new Date() } }, orderBy: { runAfter: "asc" }, take: 20 });
  for (const job of due) {
    // claim atomically so two server instances never send the same reminder twice
    const claimed = await db.job.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      if (job.type === "meeting_reminder") await runMeetingReminder(job.payload as never);
      await db.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null } });
    } catch (e) {
      const final = job.attempts + 1 >= job.maxAttempts;
      await db.job.update({
        where: { id: job.id },
        data: { status: final ? "FAILED" : "PENDING", lockedAt: null, lastError: String(e).slice(0, 2000), runAfter: new Date(Date.now() + 60_000) },
      });
    }
  }
}

export function startScheduler() {
  if (g.__evgScheduler) return;
  g.__evgScheduler = setInterval(() => { runDueJobs().catch((e) => console.error("[scheduler]", e)); }, 60_000);
  setTimeout(() => { runDueJobs().catch(() => {}); }, 5_000);
}
