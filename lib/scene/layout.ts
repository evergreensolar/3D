// Measures the installation from the model: panel tilt/direction and the height of the
// structure (clear height under the lower edge of the panels).
import * as THREE from "three";
import type { Panel } from "./panels";
import type { ShadingEngine } from "./shading";
import { tiltAzimuth } from "@/lib/energy/model";

export interface Layout {
  panelCount: number;
  tiltDeg: number;
  azimuthDeg: number;
  /** Clear height from the roof to the lower edge of the panels (m), median over panels. */
  structureHeightM: number | null;
  structureType: string;
}

const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

export function measureLayout(panels: Panel[], engine: ShadingEngine, northOffsetDeg: number): Layout {
  if (!panels.length) return { panelCount: 0, tiltDeg: 0, azimuthDeg: 0, structureHeightM: null, structureType: "No panels found" };
  const n = new THREE.Vector3();
  panels.forEach((p) => n.addScaledVector(p.normal, p.area));
  n.normalize();
  const { tilt, azimuth } = tiltAzimuth([n.x, n.y, n.z], northOffsetDeg);

  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const perPanel: number[] = [];
  for (const p of panels) {
    const d: number[] = [];
    for (let s = 0; s < p.samples.length / 3; s++) {
      // start 10 cm under the glass so the panel's own frame is not hit
      o.set(p.samples[s * 3], p.samples[s * 3 + 1] - 0.1, p.samples[s * 3 + 2]);
      const dist = engine.distanceTo(o, down, 0.25, 60);
      if (dist !== null) d.push(dist + 0.1);
    }
    if (d.length >= 4) perPanel.push(pct(d, 0.1)); // lower-edge clearance of this panel
  }
  const h = perPanel.length ? Math.round(pct(perPanel, 0.5) * 10) / 10 : null;
  const structureType = h === null ? "Not measured" : h >= 1.0 ? "Elevated structure" : h >= 0.35 ? "Low-rise structure" : "Flush mount";
  return { panelCount: panels.length, tiltDeg: Math.round(tilt), azimuthDeg: Math.round(azimuth), structureHeightM: h, structureType };
}
