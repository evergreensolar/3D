"use client";
// Reads a "structure with modules" GLB in the browser: finds the modules, measures the footprint,
// and renders a thumbnail — so the admin only has to confirm the name and Wp.
import * as THREE from "three";
import { loadModel } from "@/lib/scene/load";
import { prepareModel } from "@/lib/scene/stage";
import { detectPanels, wpFromName } from "@/lib/scene/panels";
import type { TemplateMeta } from "./types";

export type AnalyzedTemplate = Omit<TemplateMeta, "id" | "name" | "wp" | "modelUrl" | "thumbUrl"> & { suggestedWp: number | null; thumb: string; warning?: string };

export async function analyzeTemplate(file: File): Promise<AnalyzedTemplate> {
  const url = URL.createObjectURL(file);
  try {
    const root = await loadModel(url, "GLB");
    prepareModel(root); // same preparation as in the studio, so module paths match
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const panels = detectPanels(root);
    if (!panels.length) throw new Error("No modules found. Name each module component \"Solar Panel …\" or \"Module …\" in SketchUp and export again.");
    const modules = panels.map((p) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < p.tris.length; i += 3) { x0 = Math.min(x0, p.tris[i]); x1 = Math.max(x1, p.tris[i]); z0 = Math.min(z0, p.tris[i + 2]); z1 = Math.max(z1, p.tris[i + 2]); }
      return { x: (x0 + x1) / 2 - cx, z: (z0 + z1) / 2 - cz, w: x1 - x0, d: z1 - z0 };
    });
    const paths = panels.map((p) => p.path).filter((x): x is string => x !== undefined);
    return {
      panelCount: panels.length, w: size.x, d: size.z, h: size.y, cx, cz, minY: box.min.y, modules, panelPaths: paths,
      suggestedWp: panels.map((p) => wpFromName(p.name)).find((w) => w) ?? null,
      thumb: renderThumb(root, box),
      warning: paths.length < panels.length ? "Some modules were found only by colour/shape; name them \"Solar Panel …\" so their Wp is read correctly." : undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderThumb(root: THREE.Object3D, box: THREE.Box3) {
  const W = 480, H = 320;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eef2f7");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8a8a", 1.3));
  const sun = new THREE.DirectionalLight("#ffffff", 1.8);
  sun.position.set(5, 10, 7);
  scene.add(sun, root);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(35, W / H, r / 100, r * 20);
  cam.position.set(c.x + r * 1.3, c.y + r * 1.2, c.z + r * 1.7);
  cam.lookAt(c);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  scene.remove(root);
  return url;
}
