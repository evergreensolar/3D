// Ray-traced shading: for each sample point on each panel, cast a ray towards the sun and
// check whether any geometry in the model (parapets, water tanks, neighbouring buildings,
// trees, other panel rows ...) blocks it. Accelerated with a BVH so it runs per frame on phones.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { isHelper, pushMeshTriangles, SAMPLES_PER_PANEL, type Panel } from "./panels";
import { sunState, SUMMARY_HOURS, MONTH_DAY, SIM_YEAR } from "./sun";
import { istDate } from "@/lib/time";

export interface ShadingSummary {
  year: number;
  /** IST hours sampled each day (9:00–16:00, every 30 min). */
  hours: number[];
  /** Day of month sampled. */
  day: number;
  /** % of total panel area shaded, averaged over the sampled hours. */
  months: { month: number; shadedPct: number }[];
  /** matrix[month-1][hourIndex] = % panel area shaded. */
  matrix: number[][];
  annualPct: number;
  panelCount: number;
  panelAreaM2: number;
  samplesPerPanel: number;
  method: string;
}

/** Is a material see-through enough to ignore for shading (window glass etc.)? */
export function isSeeThrough(m: THREE.Material | THREE.Material[]) {
  const arr = Array.isArray(m) ? m : [m];
  return arr.every((x) => x.transparent && x.opacity < 0.5);
}

export class ShadingEngine {
  private bvh: MeshBVH | null = null;
  private geometry = new THREE.BufferGeometry();
  readonly totalArea: number;

  constructor(root: THREE.Object3D, readonly panels: Panel[]) {
    const tris: number[] = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || isHelper(mesh) || !mesh.visible || isSeeThrough(mesh.material)) return;
      pushMeshTriangles(mesh, tris);
    });
    if (tris.length) {
      this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
      this.bvh = new MeshBVH(this.geometry);
    }
    this.totalArea = panels.reduce((s, p) => s + p.area, 0);
  }

  /** Fraction (0..1) of each panel's sample points that do not receive direct sun. */
  panelShading(sunDir: ArrayLike<number>): Float32Array {
    const out = new Float32Array(this.panels.length);
    const d = new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();
    if (d.y <= 0) return out.fill(1);
    const ray = new THREE.Ray(new THREE.Vector3(), d);
    for (const p of this.panels) {
      let shaded = 0;
      for (let s = 0; s < SAMPLES_PER_PANEL; s++) {
        const nx = p.sampleNormals[s * 3], ny = p.sampleNormals[s * 3 + 1], nz = p.sampleNormals[s * 3 + 2];
        if (nx * d.x + ny * d.y + nz * d.z <= 0.01) { shaded++; continue; } // sun behind the panel plane
        ray.origin.set(p.samples[s * 3] + nx * 0.02, p.samples[s * 3 + 1] + ny * 0.02, p.samples[s * 3 + 2] + nz * 0.02);
        if (this.bvh && this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, 2000)) shaded++;
      }
      out[p.index] = shaded / SAMPLES_PER_PANEL;
    }
    return out;
  }

  /**
   * Distance along a ray to the first surface, skipping thin members within `skip` metres of the
   * start (purlins/rails right under the panels). Returns null when nothing is hit.
   */
  distanceTo(origin: THREE.Vector3, dir: THREE.Vector3, skip = 0.3, max = 100): number | null {
    if (!this.bvh) return null;
    const ray = new THREE.Ray(origin.clone(), dir.clone().normalize());
    let travelled = 0;
    for (let i = 0; i < 6; i++) {
      const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, max - travelled);
      if (!hit) return null;
      travelled += hit.distance;
      if (travelled >= skip) return travelled;
      ray.origin.copy(hit.point).addScaledVector(ray.direction, 0.01);
      travelled += 0.01;
    }
    return null;
  }

  /** Area-weighted % of total panel area shaded. */
  areaShadedPct(fractions: Float32Array) {
    if (!this.totalArea) return 0;
    let s = 0;
    for (const p of this.panels) s += p.area * fractions[p.index];
    return (100 * s) / this.totalArea;
  }

  yearlySummary(lat: number, lng: number, northOffsetDeg: number): ShadingSummary {
    const matrix: number[][] = [];
    for (let month = 1; month <= 12; month++) {
      matrix.push(
        SUMMARY_HOURS.map((h) => {
          const sun = sunState(istDate(SIM_YEAR, month, MONTH_DAY, h), lat, lng, northOffsetDeg);
          return round1(this.areaShadedPct(this.panelShading(sun.direction)));
        }),
      );
    }
    const months = matrix.map((row, i) => ({ month: i + 1, shadedPct: round1(row.reduce((a, b) => a + b, 0) / row.length) }));
    return {
      year: SIM_YEAR,
      hours: SUMMARY_HOURS,
      day: MONTH_DAY,
      months,
      matrix,
      annualPct: round1(months.reduce((a, m) => a + m.shadedPct, 0) / 12),
      panelCount: this.panels.length,
      panelAreaM2: round1(this.totalArea),
      samplesPerPanel: SAMPLES_PER_PANEL,
      method: `Ray-traced direct-beam shading on the ${MONTH_DAY}st of each month, 9:00 AM–4:00 PM IST every 30 min, ${SAMPLES_PER_PANEL} points per panel.`,
    };
  }

  /** Releases GPU-side resources only; the BVH stays usable (safe under React StrictMode re-mounts). */
  dispose() {
    this.geometry.dispose();
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
