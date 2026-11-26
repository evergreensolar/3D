// Worker path (optional, for a VPS): processes a version in headless Chromium.
// On hosts without Chromium (e.g. Hostinger managed Node.js), the designer's browser does this instead.
import { db } from "@/lib/db";
import { signedQuery } from "@/lib/storage/sign";
import { claimVersion, failVersion, finalizeVersion } from "@/lib/processing/server";
import type { ProcessingOutput } from "@/lib/processing/types";
import { getBrowser } from "./browser";

type RenderResult = (Omit<ProcessingOutput, "glb"> & { ok: true; glbBase64?: string }) | { ok: false; error: string; log: string[] };

export async function processVersion(versionId: string, finalAttempt: boolean) {
  if (!(await claimVersion(versionId))) {
    const v = await db.designVersion.findUnique({ where: { id: versionId }, select: { status: true } });
    console.log(`[worker] ${versionId} is ${v?.status ?? "missing"} — skipped (processed elsewhere)`);
    return;
  }
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(`${appUrl}/render/${versionId}?${signedQuery(`render:${versionId}`, 1800)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForFunction(() => !!(window as unknown as { __EVG_RESULT?: unknown }).__EVG_RESULT, null, { timeout: 10 * 60_000, polling: 500 });
    const r = (await page.evaluate(() => (window as unknown as { __EVG_RESULT: unknown }).__EVG_RESULT)) as RenderResult;
    if (!r.ok) throw new Error(r.error);
    await finalizeVersion(versionId, {
      glb: r.glbBase64 ? Buffer.from(r.glbBase64, "base64") : undefined,
      snapshots: r.snapshots.map(({ dataUrl, ...m }) => ({ ...m, jpeg: Buffer.from(dataUrl.split(",")[1], "base64") })),
      summary: r.summary, panelCount: r.panelCount, bbox: r.bbox, log: r.log,
    });
  } catch (e) {
    await failVersion(versionId, e instanceof Error ? e.message : String(e), consoleLines.slice(-80).join("\n"), finalAttempt);
    throw e;
  } finally {
    await ctx.close();
  }
}
