import { applyConfig, isConfigured } from "@/lib/config";
import { getDb } from "@/lib/db";
import { runMigrations } from "@/lib/setup/migrate";
import { startScheduler } from "@/lib/scheduler";

export async function startup() {
  applyConfig();
  if (!isConfigured()) {
    console.log("[setup] Not configured yet — open /setup in the browser.");
    return;
  }
  // Apply any new database migrations automatically after each deploy.
  try {
    const applied = await runMigrations(getDb());
    if (applied.length) console.log(`[setup] Applied migrations: ${applied.join(", ")}`);
  } catch (e) {
    console.error("[setup] Migration check failed:", e instanceof Error ? e.message : e);
  }
  startScheduler(); // meeting reminders

}
