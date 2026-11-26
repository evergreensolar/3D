"use client";
import { useEffect } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadModel, type ModelFormat } from "@/lib/scene/load";
import { DesignStage, VIEWS, type ViewName } from "@/lib/scene/stage";
import { bearingVector, SIM_YEAR } from "@/lib/scene/sun";
import { istDate } from "@/lib/time";

export interface Snapshot {
  name: string;
  label: string;
  kind: "view" | "shading";
  dataUrl: string;
  month?: number;
  hour?: number;
  shadedPct?: number;
  shadedPanels?: number;
}

declare global {
  interface Window { __EVG_RESULT?: unknown; __EVG_LOG?: string[] }
}

const W = 1600, H = 1000;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function Processor(props: { modelUrl: string; format: ModelFormat; lat: number; lng: number; northOffsetDeg: number }) {
  useEffect(() => {
    const log = (window.__EVG_LOG = [] as string[]);
    const say = (m: string) => { log.push(`${new Date().toISOString()} ${m}`); console.log(m); };
    (async () => {
      try {
        say(`loading ${props.format} model`);
        const root = await loadModel(props.modelUrl, props.format);
        let glbBase64: string | undefined;
        if (props.format !== "GLB") {
          say("converting COLLADA to GLB");
          const glb = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer;
          glbBase64 = toBase64(glb);
        }
        say("building stage + detecting panels");
        const stage = new DesignStage(root, { lat: props.lat, lng: props.lng, northOffsetDeg: props.northOffsetDeg, shadowMapSize: 4096 });
        say(`panels detected: ${stage.panels.length}`);

        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(W, H);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.add(stage.group);
        const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, stage.radius * 50);
        const north = new THREE.Vector3(...bearingVector(0, props.northOffsetDeg));

        const shot = (view: ViewName) => {
          camera.position.copy(stage.viewPosition(view, camera.fov, W / H));
          camera.up.copy(view === "top" ? north : new THREE.Vector3(0, 1, 0));
          camera.lookAt(stage.center);
          scene.background = stage.skyColor();
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL("image/jpeg", 0.86);
        };

        const snapshots: Snapshot[] = [];
        stage.setHighlight(false);
        stage.setTime(istDate(SIM_YEAR, 3, 20, 10.5));
        for (const v of ["se", "sw", "south", "top"] as ViewName[]) {
          snapshots.push({ name: `view-${v}`, label: VIEWS[v].label, kind: "view", dataUrl: shot(v) });
        }
        say("view snapshots done");

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
        say("shading snapshots done");

        const t0 = performance.now();
        const summary = stage.engine.yearlySummary(props.lat, props.lng, props.northOffsetDeg);
        say(`yearly summary in ${Math.round(performance.now() - t0)} ms, annual ${summary.annualPct}%`);

        window.__EVG_RESULT = {
          ok: true,
          glbBase64,
          snapshots,
          summary,
          panelCount: stage.panels.length,
          bbox: { min: stage.bbox.min.toArray(), max: stage.bbox.max.toArray() },
          log,
        };
      } catch (e) {
        say(`error: ${e instanceof Error ? e.stack : String(e)}`);
        window.__EVG_RESULT = { ok: false, error: e instanceof Error ? e.message : String(e), log };
      }
    })();
  }, [props]);
  return <div id="processor" style={{ background: "#fff" }} />;
}
