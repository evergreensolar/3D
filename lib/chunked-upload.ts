// Chunked uploads: large SketchUp exports are sent in 5 MB pieces (each a short request), then
// assembled on the server. Avoids host limits on request size, time and memory.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/config";

export const CHUNK_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[0-9a-f-]{36}$/;

const root = () => path.join(dataDir(), "uploads");
export function uploadDir(id: string) {
  if (!ID_RE.test(id)) throw new Error("Invalid upload id");
  return path.join(root(), id);
}

export async function startUpload(id: string) {
  await mkdir(uploadDir(id), { recursive: true });
  // Remove abandoned uploads older than a day.
  const entries = await readdir(root()).catch(() => [] as string[]);
  for (const e of entries) {
    const p = path.join(root(), e);
    const s = await stat(p).catch(() => null);
    if (s && Date.now() - s.mtimeMs > 86_400_000) await rm(p, { recursive: true, force: true });
  }
}

export async function saveChunk(id: string, index: number, data: Buffer) {
  if (!Number.isInteger(index) || index < 0 || index > 200) throw new Error("Invalid chunk index");
  await writeFile(path.join(uploadDir(id), `${String(index).padStart(4, "0")}.part`), data);
}

/** Joins the chunks (checking none is missing) and removes the temporary folder. */
export async function assembleUpload(id: string, expectedChunks: number): Promise<Buffer> {
  const dir = uploadDir(id);
  const parts = (await readdir(dir)).filter((f) => f.endsWith(".part")).sort();
  if (parts.length !== expectedChunks) throw new Error(`Upload incomplete: received ${parts.length} of ${expectedChunks} parts. Please upload again.`);
  const bufs = [];
  for (const p of parts) bufs.push(await readFile(path.join(dir, p)));
  await rm(dir, { recursive: true, force: true });
  return Buffer.concat(bufs);
}
