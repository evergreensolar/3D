"use client";
// Browser-side processing of an uploaded SketchUp export: DAE→GLB conversion, panel detection,
// yearly shading and report snapshots. Runs in the designer's browser (default) or in the
// headless worker (/render page) — same code either way.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadModel } from "@/lib/scene/load";
import { DesignStage, VIEWS, type ViewName } from "@/lib/scene/stage";
import { bearingVector, sunState, SIM_YEAR } from "@/lib/scene/sun";
import { estimateEnergy } from "@/lib/energy/model";
import { measureLayout } from "@/lib/scene/layout";
import { serializePanels } from "@/lib/scene/panels";
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
  const stage = new DesignStage(root, { lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg, shadowMapSize: 4096, tags: p.tags });
  // Each panel's rating: its own tag, else the project default.
  stage.panels.forEach((x) => { if (!x.wp && p.defaultWp) x.wp = p.defaultWp; });
  const knownWp = stage.panels.length > 0 && stage.panels.every((x) => !!x.wp);
  const totalWp = knownWp ? stage.panels.reduce((sum, x) => sum + (x.wp ?? 0), 0) : null;
  note(`Panels: ${stage.panels.length}${p.tags?.length ? " (tagged by designer)" : " (auto-detected)"}${totalWp ? `, ${totalWp / 1000} kWp` : ""}`);

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
    note("Measuring tilt, direction and structure height");
    const layout = measureLayout(stage.panels, stage.engine, p.northOffsetDeg);
    note("Estimating generation for every month");
    const energy = estimateEnergy({
      lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg,
      panels: stage.panels.map((x) => ({ normal: [x.normal.x, x.normal.y, x.normal.z] as [number, number, number], weight: x.wp ?? 1 })),
      shadeAt: (month, hour) => stage.engine.panelShading(sunState(istDate(SIM_YEAR, month, 21, hour), p.lat, p.lng, p.northOffsetDeg).direction),
    });
    note(`About ${Math.round(energy.annual.clean)} kWh per kWp per year`);
    return { glb, snapshots, summary, energy, layout, totalWp, panelsFile: serializePanels(stage.panels), panelCount: stage.panels.length, bbox: { min: stage.bbox.min.toArray(), max: stage.bbox.max.toArray() }, log };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    stage.dispose();
  }
}
