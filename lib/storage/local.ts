import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProvider, PutOptions, UrlOptions } from "./types";
import { signedQuery } from "./sign";

/** Stores objects on local disk; files are served by /api/files/<key> with signed URLs. */
export class LocalStorage implements StorageProvider {
  readonly name = "local";
  constructor(private root: string) {}

  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }

  async put(key: string, body: Buffer | Uint8Array, opts: PutOptions) {
    const p = this.file(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    await fs.writeFile(p + ".meta.json", JSON.stringify({ contentType: opts.contentType }));
  }

  async get(key: string) {
    return fs.readFile(this.file(key));
  }

  async contentType(key: string): Promise<string> {
    try {
      return JSON.parse(await fs.readFile(this.file(key) + ".meta.json", "utf8")).contentType;
    } catch {
      return "application/octet-stream";
    }
  }

  async exists(key: string) {
    return fs.stat(this.file(key)).then(() => true, () => false);
  }

  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
    await fs.rm(this.file(key) + ".meta.json", { force: true });
  }

  async getUrl(key: string, opts: UrlOptions = {}) {
    const extra: Record<string, string> = opts.downloadName ? { dl: opts.downloadName } : {};
    const q = signedQuery(key, opts.expiresInSec ?? 3600, extra);
    // Relative on purpose: works from any host the app is reached on. Use absoluteUrl() for messages/PDFs.
    return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}?${q}`;
  }
}
