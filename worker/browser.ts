import { chromium, type Browser } from "playwright-core";

let browser: Browser | null = null;

/** One shared headless Chromium with software WebGL (SwiftShader) — no GPU needed on the server. */
export async function getBrowser() {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
  });
  return browser;
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
}
