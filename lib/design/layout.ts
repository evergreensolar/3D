// Automatic panel layout: fills the roof outline with rows of panels facing the chosen
// direction, keeping the edge setback and staying clear of rooftop obstructions.
import type { ArraySpec, Block, Design, LibraryBlock, Obstacle, ParamBlock, Pt, TemplateMeta } from "./types";
import { roofHeight, uid } from "./types";

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

/** Auto layout (rows filling the roof) for an array spec — used by "Fill roof automatically". */
export function layoutPanels(d: { building: { outline: Pt[] }; obstacles: Obstacle[]; array: ArraySpec }): PlacedPanel[] {
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

// ---------------------------------------------------------------- structure blocks

const rot2 = (x: number, z: number, deg: number): Pt => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - z * s, x * s + z * c];
};

export function paramGeometry(b: ParamBlock) {
  const across = b.orientation === "portrait" ? b.panelW : b.panelL;
  const slope = b.orientation === "portrait" ? b.panelL : b.panelW;
  const depth = slope * Math.cos((b.tilt * Math.PI) / 180);
  const W = b.cols * across + (b.cols - 1) * b.colGap;
  const D = b.rows * depth + (b.rows - 1) * b.rowGap;
  return { across, slope, depth, W, D };
}

/** Panels of an adjustable block in plan (row 0 = front, facing side). */
export function paramPanels(b: ParamBlock): PlacedPanel[] {
  const g = paramGeometry(b);
  const { f, r } = frame(b.facing);
  const removed = new Set(b.removed);
  const at = (u: number, v: number): Pt => [b.x + u * r[0] + v * f[0], b.z + u * r[1] + v * f[1]];
  const out: PlacedPanel[] = [];
  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      const u0 = -g.W / 2 + col * (g.across + b.colGap), v1 = g.D / 2 - row * (g.depth + b.rowGap);
      const corners: Pt[] = [at(u0, v1 - g.depth), at(u0 + g.across, v1 - g.depth), at(u0 + g.across, v1), at(u0, v1)];
      const key = `${row}:${col}`;
      out.push({ key, corners, center: at(u0 + g.across / 2, v1 - g.depth / 2), removed: removed.has(key) });
    }
  }
  return out;
}

export function libraryCopies(b: LibraryBlock, t: TemplateMeta) {
  const total = b.repeat * t.w;
  return Array.from({ length: Math.max(1, b.repeat) }, (_, i) => {
    const [dx, dz] = rot2(-total / 2 + t.w / 2 + i * t.w, 0, b.rot);
    return { x: b.x + dx, z: b.z + dz };
  });
}

/** Outline of a block in plan. */
export function blockCorners(b: Block, metas: Record<string, TemplateMeta>): Pt[] {
  if (b.kind === "param") {
    const g = paramGeometry(b);
    const { f, r } = frame(b.facing);
    return ([[-g.W / 2, -g.D / 2], [g.W / 2, -g.D / 2], [g.W / 2, g.D / 2], [-g.W / 2, g.D / 2]] as Pt[])
      .map(([u, v]) => [b.x + u * r[0] + v * f[0], b.z + u * r[1] + v * f[1]] as Pt);
  }
  const t = metas[b.templateId];
  if (!t) return [];
  const hw = (b.repeat * t.w) / 2, hd = t.d / 2;
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Pt[]).map(([u, v]) => { const [dx, dz] = rot2(u, v, b.rot); return [b.x + dx, b.z + dz] as Pt; });
}

/** Module rectangles of a library block in plan. */
export function libraryModules(b: LibraryBlock, t: TemplateMeta): Pt[][] {
  return libraryCopies(b, t).flatMap((c) => t.modules.map((m) =>
    ([[m.x - m.w / 2, m.z - m.d / 2], [m.x + m.w / 2, m.z - m.d / 2], [m.x + m.w / 2, m.z + m.d / 2], [m.x - m.w / 2, m.z + m.d / 2]] as Pt[])
      .map(([u, v]) => { const [dx, dz] = rot2(u, v, b.rot); return [c.x + dx, c.z + dz] as Pt; })));
}

export function blockStats(b: Block, metas: Record<string, TemplateMeta>) {
  if (b.kind === "param") {
    const n = b.rows * b.cols - b.removed.filter((k) => { const [r, c] = k.split(":").map(Number); return r < b.rows && c < b.cols; }).length;
    return { panels: n, wp: b.wp, kwp: (n * b.wp) / 1000 };
  }
  const t = metas[b.templateId];
  const n = t ? t.panelCount * b.repeat : 0;
  return { panels: n, wp: t?.wp ?? 0, kwp: t ? (n * t.wp) / 1000 : 0 };
}

export function designStats(d: Design, metas: Record<string, TemplateMeta>) {
  return d.blocks.reduce((acc, b) => { const s = blockStats(b, metas); return { panels: acc.panels + s.panels, kwp: acc.kwp + s.kwp }; }, { panels: 0, kwp: 0 });
}

/** Problems with a block's placement. */
export function blockIssues(d: Design, b: Block, metas: Record<string, TemplateMeta>): string[] {
  const c = blockCorners(b, metas);
  const out: string[] = [];
  if (d.building.outline.length >= 3 && !c.every((p) => pointInPolygon(p, d.building.outline))) out.push("Goes outside the roof");
  if (d.obstacles.some((o) => o.onRoof && rectsOverlap(c, obstacleCorners(o, 0.1)))) out.push("Overlaps an obstruction");
  return out;
}

/** Roof surface height at a point (flat or single-slope roof). */
export function roofTopAt(d: Design, p: Pt): number {
  const top = roofHeight(d);
  const roof = d.building.roof;
  if (roof.type !== "mono" || d.building.outline.length < 3) return top;
  const { f } = frame(roof.downBearing); // f points down-slope
  const proj = (q: Pt) => q[0] * f[0] + q[1] * f[1];
  const low = Math.max(...d.building.outline.map(proj)); // lowest edge = furthest down-slope
  return top + (low - proj(p)) * Math.tan((roof.slopeDeg * Math.PI) / 180);
}

/** "Fill roof automatically": one adjustable block per row of panels. */
export function autoFillBlocks(d: Design): ParamBlock[] {
  const a = d.array;
  const panels = layoutPanels({ building: d.building, obstacles: d.obstacles, array: { ...a, removed: [] } });
  const byRow = new Map<number, { col: number; center: Pt }[]>();
  for (const p of panels) {
    const [row, col] = p.key.split(":").map(Number);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push({ col, center: p.center });
  }
  const blocks: ParamBlock[] = [];
  for (const list of byRow.values()) {
    list.sort((x, y) => x.col - y.col);
    // split into runs of consecutive columns
    let run: typeof list = [];
    const flush = () => {
      if (!run.length) return;
      const cx = run.reduce((s, q) => s + q.center[0], 0) / run.length, cz = run.reduce((s, q) => s + q.center[1], 0) / run.length;
      blocks.push({
        id: uid(), kind: "param", x: cx, z: cz, facing: a.azimuth, rows: 1, cols: run.length, orientation: a.orientation, tilt: a.tilt,
        height: a.structureHeight, wp: a.wp, panelL: a.panelL, panelW: a.panelW, rowGap: 0.05, colGap: a.colGap, removed: [],
      });
      run = [];
    };
    for (const q of list) { if (run.length && q.col !== run[run.length - 1].col + 1) flush(); run.push(q); }
    flush();
  }
  return blocks;
}

/** Older (v1) studio designs → v2 with structure blocks. */
export function migrateDesign(raw: unknown): Design {
  const d = raw as Design & { version: number };
  if (d.version === 2) return d;
  const v2: Design = {
    version: 2, site: d.site, units: "m",
    building: { ...d.building, roof: { type: "flat" } }, obstacles: d.obstacles ?? [], blocks: [],
    array: { ...d.array, removed: [] }, inverter: d.inverter ?? null,
  };
  v2.blocks = autoFillBlocks(v2);
  return v2;
}
