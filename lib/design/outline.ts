// Survey-style roof outlines: rectangle by sizes, "walk the edges" (direction + length),
// editing one side's length, and naming sides by the compass direction they face.
import type { Pt } from "./types";

const D2R = Math.PI / 180;
/** Unit step for a compass bearing (x = east, z = south). */
export const dirOf = (bearing: number): Pt => [Math.sin(bearing * D2R), -Math.cos(bearing * D2R)];
export const bearingOf = (dx: number, dz: number) => ((Math.atan2(dx, -dz) / D2R) + 360) % 360;

export interface Edge { i: number; a: Pt; b: Pt; length: number; bearing: number; side: number }

function signedArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}

/** Edges with length, walking direction and the compass direction the side faces (outward). */
export function edgesOf(poly: Pt[]): Edge[] {
  if (poly.length < 2) return [];
  const cw = signedArea(poly) > 0; // in x-east / z-south coordinates, positive = clockwise seen from above
  const n = poly.length >= 3 ? poly.length : poly.length - 1;
  return Array.from({ length: n }, (_, i) => {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const bearing = bearingOf(dx, dz);
    return { i, a, b, length: Math.hypot(dx, dz), bearing, side: (bearing + (cw ? -90 : 90) + 360) % 360 };
  });
}

/** Rectangle: width east–west, depth north–south, centred on (cx, cz); corners NW, NE, SE, SW. */
export const rectangle = (w: number, d: number, cx = 0, cz = 0): Pt[] => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];

/** Walk from a start point: each step goes `length` metres towards `bearing`. */
export function walk(start: Pt, steps: { bearing: number; length: number }[]): Pt[] {
  const pts: Pt[] = [start];
  for (const s of steps) {
    const [ux, uz] = dirOf(s.bearing);
    const [x, z] = pts[pts.length - 1];
    pts.push([x + ux * s.length, z + uz * s.length]);
  }
  return pts;
}

/** Distance from the last walked point back to the start (should be ~0 for a closed survey). */
export const closingGap = (pts: Pt[]) => (pts.length < 2 ? 0 : Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]));

/** Changes side i to `length`, moving all later corners along that side's direction (the closing side adjusts). */
export function setEdgeLength(poly: Pt[], i: number, length: number): Pt[] {
  if (i >= poly.length - 1) return poly; // the closing side follows the others
  const [ax, az] = poly[i], [bx, bz] = poly[i + 1];
  const cur = Math.hypot(bx - ax, bz - az) || 1;
  const k = (length - cur) / cur;
  const dx = (bx - ax) * k, dz = (bz - az) * k;
  return poly.map((p, j) => (j > i ? [p[0] + dx, p[1] + dz] as Pt : p));
}

/** Snaps a new point so the new side runs N/S/E/W from the previous corner (within 12°). */
export function snapOrtho(prev: Pt, p: Pt): Pt {
  const dx = p[0] - prev[0], dz = p[1] - prev[1];
  const b = bearingOf(dx, dz), len = Math.hypot(dx, dz);
  const nearest = Math.round(b / 90) * 90;
  const diff = Math.abs(((b - nearest + 540) % 360) - 180);
  if (diff > 12) return p;
  const [ux, uz] = dirOf(nearest);
  return [prev[0] + ux * len, prev[1] + uz * len];
}

/** True for a 4-corner outline whose corners are all ~90°. */
export function isRectangle(poly: Pt[]) {
  if (poly.length !== 4) return false;
  return poly.every((p, i) => {
    const a = poly[(i + 3) % 4], b = poly[(i + 1) % 4];
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1);
    return Math.abs(cos) < 0.02;
  });
}

/** Changes one side's length; a rectangle stays a rectangle (the opposite side changes too). */
export function setSideLength(poly: Pt[], i: number, length: number): Pt[] {
  if (!isRectangle(poly)) return setEdgeLength(poly, i, length);
  const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % 4];
  const cur = Math.hypot(bx - ax, bz - az) || 1;
  const dx = ((bx - ax) / cur) * (length - cur), dz = ((bz - az) / cur) * (length - cur);
  const move = new Set([(i + 1) % 4, (i + 2) % 4]);
  return poly.map((p, j) => (move.has(j) ? [p[0] + dx, p[1] + dz] as Pt : p));
}
