import type { ModelFormat } from "@prisma/client";

export const MAX_MODEL_BYTES = 300 * 1024 * 1024;

/** Detects the model format from file contents (not the extension). */
export function sniffModelFormat(buf: Buffer): ModelFormat | null {
  if (buf.subarray(0, 4).toString("latin1") === "glTF") return "GLB";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "ZIP";
  const head = buf.subarray(0, 4096).toString("utf8");
  if (/<COLLADA[\s>]/i.test(head)) return "DAE";
  return null;
}

export const FORMAT_EXT: Record<ModelFormat, string> = { GLB: "glb", DAE: "dae", ZIP: "zip" };
export const FORMAT_MIME: Record<ModelFormat, string> = { GLB: "model/gltf-binary", DAE: "model/vnd.collada+xml", ZIP: "application/zip" };
