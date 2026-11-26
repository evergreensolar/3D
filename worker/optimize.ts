// Lossless GLB clean-up so models load faster on phones: merges duplicate materials/meshes,
// welds vertices and drops unused data. Node names (used for panel detection) are preserved.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld } from "@gltf-transform/functions";

export async function optimizeGlb(input: Uint8Array): Promise<Uint8Array> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(input);
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true }));
  return io.writeBinary(doc);
}
