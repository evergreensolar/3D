// Automatic panel layout: fills the roof outline with rows of panels facing the chosen
// direction, keeping the edge setback and staying clear of rooftop obstructions.
import type { Design, Obstacle, Pt } from "./types";

const D2R = Math.PI / 180;

export function pointInPolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function distToEdges(p: Pt, poly: Pt[]) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return m;
}

export function polygonArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

/** Corners of an obstacle footprint (rectangle or circle's bounding square). */
export function obstacleCorners(o: Obstacle, margin = 0): Pt[] {
  const r = o.rot * D2R, c = Math.cos(r), s = Math.sin(r);
  const hw = o.w / 2 + margin, hd = o.d / 2 + margin;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Pt[]).map(([u, v]) => [o.x + u * c - v * s, o.z + u * s + v * c]);
}

function rectsOverlap(a: Pt[], b: Pt[]) {
  // separating axis test for two convex quads
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1, nz = x1 - x2;
      const pa = a.map(([x, z]) => x * nx + z * nz), pb = b.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

export interface PlacedPanel {
  key: string;
  corners: Pt[]; // plan footprint
  center: Pt; // plan centre
  removed: boolean;
}

/** Facing direction (unit, plan) and the row direction for a compass azimuth. */
export function frame(azimuth: number) {
  const b = azimuth * D2R;
  const f: Pt = [Math.sin(b), -Math.cos(b)]; // faces this way (x, z)
  const r: Pt = [-f[1], f[0]]; // along the row
  return { f, r };
}

export function layoutPanels(d: Design): PlacedPanel[] {
  const poly = d.building.outline;
  if (poly.length < 3) return [];
  const a = d.array;
  const across = a.orientation === "portrait" ? a.panelW : a.panelL; // along the row
  const slope = a.orientation === "portrait" ? a.panelL : a.panelW; // up the tilt
  const depth = slope * Math.cos(a.tilt * D2R); // plan depth of one row
  const pitchRow = depth + a.rowGap, pitchCol = across + a.colGap;
  const { f, r } = frame(a.azimuth);
  // polygon extent in (row, facing) coordinates
  const us = poly.map(([x, z]) => x * r[0] + z * r[1]);
  const vs = poly.map(([x, z]) => x * f[0] + z * f[1]);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const blockers = d.obstacles.filter((o) => o.onRoof).map((o) => obstacleCorners(o, 0.3));
  const removed = new Set(a.removed);
  const out: PlacedPanel[] = [];
  const toXZ = (u: number, v: number): Pt => [u * r[0] + v * f[0], u * r[1] + v * f[1]];
  // start from the front (sunny) edge so leftovers end up at the back
  for (let row = 0, v = v1 - a.setback - depth; v >= v0 + a.setback - 1e-6; v -= pitchRow, row++) {
    for (let col = 0, u = u0 + a.setback; u + across <= u1 - a.setback + 1e-6; u += pitchCol, col++) {
      const corners: Pt[] = [toXZ(u, v), toXZ(u + across, v), toXZ(u + across, v + depth), toXZ(u, v + depth)];
      if (!corners.every((c) => pointInPolygon(c, poly) && distToEdges(c, poly) >= a.setback - 1e-6)) continue;
      if (blockers.some((b) => rectsOverlap(corners, b))) continue;
      const key = `${row}:${col}`;
      out.push({ key, corners, center: toXZ(u + across / 2, v + depth / 2), removed: removed.has(key) });
    }
  }
  return out;
}

export function activePanels(d: Design) {
  return layoutPanels(d).filter((p) => !p.removed);
}
