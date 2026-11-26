"use client";
// Loads SketchUp exports (GLB, COLLADA .dae, or a .zip of .dae + textures) into a three.js object.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { unzipSync } from "fflate";

export type ModelFormat = "GLB" | "DAE" | "ZIP";

function gltfLoader(manager?: THREE.LoadingManager) {
  const l = new GLTFLoader(manager);
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  l.setDRACOLoader(draco);
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

export async function loadModel(url: string, format: ModelFormat, onProgress?: (fraction: number) => void): Promise<THREE.Object3D> {
  const progress = (e: ProgressEvent) => e.lengthComputable && onProgress?.(e.loaded / e.total);
  if (format === "GLB") {
    const gltf = await gltfLoader().loadAsync(url, progress);
    return gltf.scene;
  }
  if (format === "DAE") {
    const dae = await new ColladaLoader().loadAsync(url, progress);
    return dae.scene;
  }
  // ZIP: find the .dae and serve its textures from memory.
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const files = unzipSync(buf);
  const names = Object.keys(files).filter((n) => !n.startsWith("__MACOSX"));
  const daeName = names.find((n) => n.toLowerCase().endsWith(".dae"));
  if (!daeName) throw new Error("The zip file does not contain a .dae model");
  const blobUrls = new Map<string, string>();
  for (const n of names) {
    if (n === daeName || n.endsWith("/")) continue;
    blobUrls.set(n.split("/").pop()!.toLowerCase(), URL.createObjectURL(new Blob([files[n] as BlobPart])));
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => {
    const base = decodeURIComponent(u.split(/[\\/]/).pop() || "").toLowerCase();
    return blobUrls.get(base) ?? u;
  });
  let started = false;
  let loaded = false;
  manager.onStart = () => { started = true; };
  manager.onLoad = () => { loaded = true; };
  const text = new TextDecoder().decode(files[daeName]);
  const dae = new ColladaLoader(manager).parse(text, "");
  // Wait (max 15 s) for textures referenced through the manager.
  const t0 = Date.now();
  while (started && !loaded && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 50));
  return dae.scene;
}
