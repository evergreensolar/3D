// Background worker: picks jobs from the `Job` table (FOR UPDATE SKIP LOCKED, so several
// workers can run side by side) and processes uploaded design versions.
//
//   npm run worker
import { db } from "@/lib/db";
import { processVersion } from "./process-version";
import { closeBrowser } from "./browser";

const POLL_MS = 2000;
const STALE_MIN = 15;
let stopping = false;

type JobRow = { id: string; type: string; payload: unknown; attempts: number; maxAttempts: number };

async function claim(): Promise<JobRow | null> {
  const rows = await db.$queryRaw<JobRow[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAfter" <= now()
      ORDER BY "runAfter" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, "maxAttempts"`;
  return rows[0] ?? null;
}

async function recoverStale() {
  await db.$executeRaw`
    UPDATE "Job" SET status = 'PENDING', "lockedAt" = NULL
    WHERE status = 'RUNNING' AND "lockedAt" < now() - (${STALE_MIN} * interval '1 minute')`;
}

async function run(job: JobRow) {
  switch (job.type) {
    case "process_version":
      return processVersion((job.payload as { versionId: string }).versionId, job.attempts >= job.maxAttempts);
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

async function loop() {
  console.log("[worker] started");
  await recoverStale();
  let lastRecover = Date.now();
  while (!stopping) {
    if (Date.now() - lastRecover > 60_000) { await recoverStale(); lastRecover = Date.now(); }
    const job = await claim().catch((e) => { console.error("[worker] claim failed", e.message); return null; });
    if (!job) { await new Promise((r) => setTimeout(r, POLL_MS)); continue; }
    const t0 = Date.now();
    console.log(`[worker] ${job.type} ${job.id} (attempt ${job.attempts})`);
    try {
      await run(job);
      await db.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null } });
      console.log(`[worker] done ${job.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const final = job.attempts >= job.maxAttempts;
      console.error(`[worker] failed ${job.id}: ${msg}${final ? " (giving up)" : " (will retry)"}`);
      await db.job.update({
        where: { id: job.id },
        data: { status: final ? "FAILED" : "PENDING", lastError: msg.slice(0, 2000), lockedAt: null, runAfter: new Date(Date.now() + 30_000 * job.attempts) },
      });
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stopping = true;
    await closeBrowser();
    await db.$disconnect();
    process.exit(0);
  });
}

loop().catch((e) => { console.error(e); process.exit(1); });
