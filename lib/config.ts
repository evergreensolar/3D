// Runtime configuration written by the first-run setup page (/setup).
// Stored OUTSIDE the app folder (default ~/.evergreen-portal/config.json) so it survives redeploys.
// Values are copied into process.env at startup, so the rest of the code reads process.env as usual.
// Real environment variables always win over the file.
import { mkdirSync, readFileSync, writeFileSync, existsSync, accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RuntimeConfig {
  DATABASE_URL: string;
  APP_URL: string;
  SESSION_SECRET: string;
  [key: string]: string;
}

function writable(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let cachedDir: string | null = null;
/** Persistent data folder for config and (local) uploads. */
export function dataDir(): string {
  if (cachedDir) return cachedDir;
  const candidates = [process.env.EVG_DATA_DIR, path.join(os.homedir(), ".evergreen-portal"), path.join(process.cwd(), ".data")].filter(Boolean) as string[];
  cachedDir = candidates.find(writable) ?? candidates[candidates.length - 1];
  return cachedDir;
}

export const configFile = () => path.join(dataDir(), "config.json");

export function readConfig(): Partial<RuntimeConfig> {
  try {
    return existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), "utf8")) : {};
  } catch {
    return {};
  }
}

export function saveConfig(cfg: Partial<RuntimeConfig>) {
  const merged = { ...readConfig(), ...cfg };
  writeFileSync(configFile(), JSON.stringify(merged, null, 2), { mode: 0o600 });
  applyConfig(true);
}

/** Copies config values into process.env (env vars set by the host take priority unless `force`). */
export function applyConfig(force = false) {
  const cfg = readConfig();
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === "string" && (force || !process.env[k])) process.env[k] = v;
  }
  if (!process.env.STORAGE_LOCAL_DIR) process.env.STORAGE_LOCAL_DIR = path.join(dataDir(), "storage");
}

export function isConfigured() {
  applyConfig();
  return !!(process.env.DATABASE_URL && process.env.SESSION_SECRET && (process.env.SESSION_SECRET?.length ?? 0) >= 32);
}
