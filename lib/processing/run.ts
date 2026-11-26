"use client";
// Browser-side processing of an uploaded SketchUp export: DAE→GLB conversion, panel detection,
// yearly shading and report snapshots. Runs in the designer's browser (default) or in the
// headless worker (/render page) — same code either way.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadModel } from "@/lib/scene/load";
import { DesignStage, VIEWS, type ViewName } from "@/lib/scene/stage";
import { bearingVector, SIM_YEAR } from "@/lib/scene/sun";
import { istDate } from "@/lib/time";
import type { ProcessingInput, ProcessingOutput } from "./types";

const W = 1600, H = 1000;

export async function runProcessing(p: ProcessingInput, say: (m: string) => void = () => {}): Promise<ProcessingOutput> {
  const log: string[] = [];
  const note = (m: string) => { log.push(`${new Date().toISOString()} ${m}`); say(m); };

  note(`Loading the ${p.format} model`);
  const root = await loadModel(p.modelUrl, p.format);
  let glb: ArrayBuffer | undefined;
  if (p.format !== "GLB") {
    note("Converting COLLADA to GLB");
    glb = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer;
  }
  note("Finding the solar panels");
  const stage = new DesignStage(root, { lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg, shadowMapSize: 4096 });
  note(`Panels found: ${stage.panels.length}`);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(stage.group);
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, stage.radius * 50);
    const north = new THREE.Vector3(...bearingVector(0, p.northOffsetDeg));
    const shot = (view: ViewName) => {
      camera.position.copy(stage.viewPosition(view, camera.fov, W / H));
      camera.up.copy(view === "top" ? north : new THREE.Vector3(0, 1, 0));
      camera.lookAt(stage.center);
      scene.background = stage.skyColor();
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/jpeg", 0.86);
    };

    note("Rendering report pictures");
    const snapshots: ProcessingOutput["snapshots"] = [];
    stage.setHighlight(false);
    stage.setTime(istDate(SIM_YEAR, 3, 20, 10.5));
    for (const v of ["se", "sw", "south", "top"] as ViewName[]) {
      snapshots.push({ name: `view-${v}`, label: VIEWS[v].label, kind: "view", dataUrl: shot(v) });
    }
    stage.setHighlight(true);
    for (const [season, month] of [["Summer (21 Jun)", 6], ["Winter (21 Dec)", 12]] as const) {
      for (const hour of [9, 12, 15]) {
        const r = stage.setTime(istDate(SIM_YEAR, month, 21, hour));
        const hh = hour === 12 ? "12 noon" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
        snapshots.push({
          name: `shade-${month}-${hour}`, label: `${season}, ${hh}`, kind: "shading", month, hour,
          shadedPct: Math.round(r.areaShadedPct * 10) / 10, shadedPanels: r.shadedPanels, dataUrl: shot("shading"),
        });
      }
    }
    note("Calculating a year of shading");
    const summary = stage.engine.yearlySummary(p.lat, p.lng, p.northOffsetDeg);
    note(`Year-average shading ${summary.annualPct}%`);
    return { glb, snapshots, summary, panelCount: stage.panels.length, bbox: { min: stage.bbox.min.toArray(), max: stage.bbox.max.toArray() }, log };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    stage.dispose();
  }
}
