import path from "node:path";
import type { StorageProvider } from "./types";
import { applyConfig, dataDir } from "@/lib/config";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

let instance: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (instance) return instance;
  applyConfig();
  const driver = process.env.STORAGE_DRIVER || "local";
  if (driver === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    instance = new S3Storage(process.env.S3_BUCKET);
  } else if (driver === "local") {
    instance = new LocalStorage(path.resolve(process.env.STORAGE_LOCAL_DIR || path.join(dataDir(), "storage")));
  } else {
    throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
  }
  return instance;
}

export const keys = {
  original: (projectId: string, v: number, ext: string) => `projects/${projectId}/v${v}/original.${ext}`,
  model: (projectId: string, v: number) => `projects/${projectId}/v${v}/model.glb`,
  snapshot: (projectId: string, v: number, name: string) => `projects/${projectId}/v${v}/snapshots/${name}.jpg`,
  report: (projectId: string, v: number) => `projects/${projectId}/v${v}/report.pdf`,
  panels: (projectId: string, v: number) => `projects/${projectId}/v${v}/panels.json`,
};

export type { StorageProvider } from "./types";

/** Turn a storage URL into an absolute one (local driver URLs are relative). */
export function absoluteUrl(u: string) {
  return u.startsWith("/") ? (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "") + u : u;
}
