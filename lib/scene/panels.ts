// Finds the solar panels in a SketchUp export and prepares sample points on each panel's
// top (sun-facing) surface for shading analysis.
//
// Naming convention for the design team (see README):
//   • Each panel is a SketchUp Component/Group whose name contains "Solar Panel" / "PV Module"
//     (e.g. "Solar Panel 550W"), OR
//   • the panel glass uses a material whose name contains "Solar Panel" / "PV Glass" / "Solar Cell".
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export const PANEL_NODE_RE = /(solar[\s_-]*(pv[\s_-]*)?(panel|module)|pv[\s_-]*(panel|module)|(^|[\s_#.-])(panel|module)s?($|[\s_#.\d-]))/i;
export const PANEL_MATERIAL_RE = /(solar[\s_-]*(panel|cell|glass|module)|pv[\s_-]*(cell|glass|module|panel))/i;

/** Groups bigger than this (m² of top surface) that contain several matching children are split. */
const MAX_SINGLE_PANEL_AREA = 3.6;
export const SAMPLES_PER_PANEL = 64;

export interface Panel {
  index: number;
  name: string;
  /** Rating in Wp when tagged by the designer (otherwise the project default applies). */
  wp?: number;
  /** Node address in the original model (child indices from the root), when the panel is a node. */
  path?: string;
  /** World-space top-surface triangles (9 floats per triangle). */
  tris: Float32Array;
  /** Per-triangle upward-oriented normal (3 floats per triangle). */
  triNormals: Float32Array;
  area: number;
  normal: THREE.Vector3;
  center: THREE.Vector3;
  samples: Float32Array;
  sampleNormals: Float32Array;
}

export const isHelper = (o: THREE.Object3D) => !!o.userData.evgHelper;

const nodeName = (o: THREE.Object3D) => `${o.userData?.name ?? ""} ${o.name ?? ""}`.trim();
/** Parts of a panel or of the mounting structure — never a whole panel on their own. */
const PART_RE = /(frame|glass|cell|backsheet|junction|j[\s_-]?box|clamp|rail|purlin|rafter|leg|structure|mount|bracket|bolt|cable|wire)/i;
const matchesName = (n: string) => PANEL_NODE_RE.test(n) && !PART_RE.test(n);
const nameMatches = (o: THREE.Object3D) => matchesName(o.userData?.name ?? "") || matchesName(o.name ?? "");

function materialName(m: THREE.Material | undefined) {
  return m ? `${m.name ?? ""} ${(m.userData as { name?: string })?.name ?? ""}` : "";
}

export function collectMeshes(node: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !isHelper(o)) out.push(o as THREE.Mesh);
  });
  return out;
}

/** Appends world-space triangles of a mesh (optionally only the given index range). */
export function pushMeshTriangles(mesh: THREE.Mesh, out: number[], start = 0, count = Infinity) {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const idx = g.index;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const total = idx ? idx.count : pos.count;
  const end = Math.min(total, start + count);
  for (let i = start; i < end - ((end - start) % 3); i++) {
    v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
    out.push(v.x, v.y, v.z);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

function triNormalArea(t: ArrayLike<number>, i: number, n: THREE.Vector3) {
  _a.set(t[i], t[i + 1], t[i + 2]);
  _b.set(t[i + 3], t[i + 4], t[i + 5]);
  _c.set(t[i + 6], t[i + 7], t[i + 8]);
  n.subVectors(_c, _b).cross(_a.clone().sub(_b));
  const len = n.length();
  if (len > 0) n.divideScalar(len);
  return len / 2;
}

function roughTopArea(tris: number[]) {
  let a = 0;
  for (let i = 0; i < tris.length; i += 9) {
    const area = triNormalArea(tris, i, _n);
    if (Math.abs(_n.y) > 0.25) a += area * Math.abs(_n.y);
  }
  return a / 2; // top + bottom faces
}

function subtreeHasMatch(o: THREE.Object3D): boolean {
  if (nameMatches(o)) return true;
  return o.children.some(subtreeHasMatch);
}

function buildPanel(name: string, all: number[]): Omit<Panel, "index"> | null {
  if (all.length < 9) return null;
  // BVH over the panel's own geometry, used to drop bottom faces (backsheet) that sit under the glass.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
  const bvh = new MeshBVH(geo);
  const ray = new THREE.Ray();
  const keptTris: number[] = [];
  const keptNormals: number[] = [];
  const areas: number[] = [];
  const n = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  for (let i = 0; i < all.length; i += 9) {
    const area = triNormalArea(all, i, n);
    if (area < 1e-6 || Math.abs(n.y) < 0.5) continue; // panels are tilted < 60°
    if (n.y < 0) n.negate(); // SketchUp reversed faces
    centroid.set((all[i] + all[i + 3] + all[i + 6]) / 3, (all[i + 1] + all[i + 4] + all[i + 7]) / 3, (all[i + 2] + all[i + 5] + all[i + 8]) / 3);
    ray.origin.copy(centroid).addScaledVector(n, 0.002);
    ray.direction.copy(n);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, 0.2);
    if (hit) continue; // something of this panel is directly above → not the top surface
    for (let k = 0; k < 9; k++) keptTris.push(all[i + k]);
    keptNormals.push(n.x, n.y, n.z);
    areas.push(area);
  }
  geo.dispose();
  // Keep only faces aligned with the dominant surface (drops frame edges / bevels).
  const dom = new THREE.Vector3();
  areas.forEach((a, t) => dom.add(new THREE.Vector3(keptNormals[t * 3], keptNormals[t * 3 + 1], keptNormals[t * 3 + 2]).multiplyScalar(a)));
  dom.normalize();
  for (let t = areas.length - 1; t >= 0; t--) {
    if (keptNormals[t * 3] * dom.x + keptNormals[t * 3 + 1] * dom.y + keptNormals[t * 3 + 2] * dom.z < 0.95) {
      areas.splice(t, 1);
      keptNormals.splice(t * 3, 3);
      keptTris.splice(t * 9, 9);
    }
  }
  const total = areas.reduce((s, a) => s + a, 0);
  if (total < 0.05) return null;

  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (let t = 0; t < areas.length; t++) {
    normal.x += keptNormals[t * 3] * areas[t];
    normal.y += keptNormals[t * 3 + 1] * areas[t];
    normal.z += keptNormals[t * 3 + 2] * areas[t];
    const i = t * 9;
    center.x += ((keptTris[i] + keptTris[i + 3] + keptTris[i + 6]) / 3) * areas[t];
    center.y += ((keptTris[i + 1] + keptTris[i + 4] + keptTris[i + 7]) / 3) * areas[t];
    center.z += ((keptTris[i + 2] + keptTris[i + 5] + keptTris[i + 8]) / 3) * areas[t];
  }
  normal.normalize();
  center.divideScalar(total);

  // Evenly spread samples: each triangle gets a share proportional to its area (largest
  // remainder), placed with the R2 low-discrepancy sequence so shadow edges are resolved well.
  const quota = areas.map((a) => (a / total) * SAMPLES_PER_PANEL);
  const counts = quota.map(Math.floor);
  let left = SAMPLES_PER_PANEL - counts.reduce((a, b) => a + b, 0);
  quota.map((q, i) => [q - Math.floor(q), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left--; } });
  const samples = new Float32Array(SAMPLES_PER_PANEL * 3);
  const sampleNormals = new Float32Array(SAMPLES_PER_PANEL * 3);
  const A1 = 0.7548776662466927, A2 = 0.5698402909980532;
  let s = 0;
  counts.forEach((c, t) => {
    const i = t * 9;
    for (let j = 0; j < c; j++, s++) {
      let r1 = (0.5 + A1 * (j + 1)) % 1, r2 = (0.5 + A2 * (j + 1)) % 1;
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      for (let k = 0; k < 3; k++) {
        samples[s * 3 + k] = keptTris[i + k] + r1 * (keptTris[i + 3 + k] - keptTris[i + k]) + r2 * (keptTris[i + 6 + k] - keptTris[i + k]);
        sampleNormals[s * 3 + k] = keptNormals[t * 3 + k];
      }
    }
  });
  return { name, tris: new Float32Array(keptTris), triNormals: new Float32Array(keptNormals), area: total, normal, center, samples, sampleNormals };
}

/** Splits loose triangles into connected pieces (shared vertices, 5 mm tolerance). */
function connectedComponents(tris: number[]): number[][] {
  const triCount = tris.length / 9;
  const parent = Array.from({ length: triCount }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map<string, number>();
  const key = (i: number) => `${Math.round(tris[i] * 200)},${Math.round(tris[i + 1] * 200)},${Math.round(tris[i + 2] * 200)}`;
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const k = key(t * 9 + v * 3);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, t);
      else parent[find(t)] = find(o);
    }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    for (let k = 0; k < 9; k++) g.push(tris[t * 9 + k]);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- shape-based detection
// Fallback when nothing is named or coloured as a panel: any thin, roughly upward-facing
// rectangle the size of a PV module (e.g. 2278 × 1134 × 35 mm) counts as a panel.
export const PANEL_SHAPE = { minShort: 0.9, maxShort: 1.45, minLong: 1.55, maxLong: 2.7, maxThick: 0.08, minUp: 0.5 };

/** Size of a triangle soup measured along its own axes: [thickness, short side, long side] and facing. */
export function shapeOf(tris: ArrayLike<number>) {
  const n = new THREE.Vector3();
  const big = new THREE.Vector3();
  let bigArea = 0;
  const tn = new THREE.Vector3();
  for (let i = 0; i < tris.length; i += 9) {
    const a = triNormalArea(tris, i, tn);
    if (a > bigArea) { bigArea = a; big.copy(tn); }
  }
  if (bigArea === 0) return null;
  for (let i = 0; i < tris.length; i += 9) {
    const a = triNormalArea(tris, i, tn);
    const d = tn.dot(big);
    if (Math.abs(d) > 0.9) n.addScaledVector(tn, a * Math.sign(d));
  }
  n.normalize();
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(u)) > 0.9) u.set(0, 0, 1);
  u.sub(n.clone().multiplyScalar(n.dot(u))).normalize();
  const w = new THREE.Vector3().crossVectors(n, u);
  // 2D principal axes in the panel plane
  let mx = 0, my = 0;
  const cnt = tris.length / 3;
  const P = new THREE.Vector3();
  const pts: number[] = [];
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    P.set(tris[i], tris[i + 1], tris[i + 2]);
    const t = P.dot(n);
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    const x = P.dot(u), y = P.dot(w);
    pts.push(x, y); mx += x; my += y;
  }
  mx /= cnt; my /= cnt;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - mx, dy = pts[i + 1] - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const c = Math.cos(th), sn = Math.sin(th);
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const a = pts[i] * c + pts[i + 1] * sn, b = -pts[i] * sn + pts[i + 1] * c;
    aMin = Math.min(aMin, a); aMax = Math.max(aMax, a); bMin = Math.min(bMin, b); bMax = Math.max(bMax, b);
  }
  const s1 = aMax - aMin, s2 = bMax - bMin;
  return { thick: tMax - tMin, short: Math.min(s1, s2), long: Math.max(s1, s2), up: Math.abs(n.y) };
}

export function looksLikePanel(tris: ArrayLike<number>) {
  if (tris.length < 9) return false;
  const sh = shapeOf(tris);
  const S = PANEL_SHAPE;
  return !!sh && sh.thick <= S.maxThick && sh.short >= S.minShort && sh.short <= S.maxShort && sh.long >= S.minLong && sh.long <= S.maxLong && sh.up >= S.minUp;
}

function detectByShape(root: THREE.Object3D): { name: string; tris: number[]; path?: string }[] {
  const meshTris = new Map<THREE.Mesh, { tris: number[]; box: THREE.Box3 }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || isHelper(m)) return;
    const tris: number[] = [];
    pushMeshTriangles(m, tris);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) box.expandByPoint(v.set(tris[i], tris[i + 1], tris[i + 2]));
    meshTris.set(m, { tris, box });
  });
  const out: { name: string; tris: number[]; path?: string }[] = [];
  const claimed = new Set<THREE.Mesh>();
  const visit = (node: THREE.Object3D) => {
    if (isHelper(node)) return;
    const meshes = collectMeshes(node).filter((m) => meshTris.has(m) && !claimed.has(m));
    if (!meshes.length) return;
    const box = new THREE.Box3();
    let count = 0;
    meshes.forEach((m) => { const t = meshTris.get(m)!; box.union(t.box); count += t.tris.length / 9; });
    const size = box.getSize(new THREE.Vector3());
    if (node !== root && count <= 20000 && Math.max(size.x, size.y, size.z) <= PANEL_SHAPE.maxLong + 0.2) {
      const tris = meshes.flatMap((m) => meshTris.get(m)!.tris);
      if (looksLikePanel(tris)) {
        out.push({ name: nodeName(node) || "Panel", tris, path: nodePath(root, node) });
        meshes.forEach((m) => claimed.add(m));
        return;
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
  // Meshes that merge several loose panels: check each connected piece.
  for (const [m, t] of meshTris) {
    if (claimed.has(m) || t.tris.length / 9 > 200000) continue;
    const size = t.box.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) <= PANEL_SHAPE.maxLong + 0.2) continue; // already checked as a node
    for (const piece of connectedComponents(t.tris)) if (looksLikePanel(piece)) out.push({ name: "Panel", tris: piece });
  }
  return out;
}

export interface PanelTag {
  path: string;
  wp: number;
  name?: string;
}

/**
 * Finds the panels. With designer tags, exactly the tagged nodes are panels (each with its own Wp);
 * otherwise panels are detected by name ("Solar Panel", "Module"…), material, or shape.
 */
export function detectPanels(root: THREE.Object3D, tags?: PanelTag[] | null): Panel[] {
  root.updateMatrixWorld(true);
  if (tags && tags.length) return panelsFromTags(root, tags);
  const found: { name: string; tris: number[]; path?: string }[] = [];
  const claimed = new Set<THREE.Mesh>();

  const visit = (node: THREE.Object3D) => {
    if (isHelper(node)) return;
    if (node !== root && nameMatches(node)) {
      const meshes = collectMeshes(node);
      if (meshes.length) {
        const tris: number[] = [];
        meshes.forEach((m) => pushMeshTriangles(m, tris));
        const matchingChildren = node.children.filter(subtreeHasMatch).length;
        if (matchingChildren >= 2 && roughTopArea(tris) > MAX_SINGLE_PANEL_AREA) {
          node.children.forEach(visit); // a container like "Solar Panels" → look inside
          return;
        }
        found.push({ name: nodeName(node), tris, path: nodePath(root, node) });
        meshes.forEach((m) => claimed.add(m));
        return;
      }
    }
    node.children.forEach(visit);
  };
  visit(root);

  // Material-based detection for exports that flatten the hierarchy.
  const loose: number[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || claimed.has(mesh) || isHelper(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (Array.isArray(mesh.material) && geo.groups.length) {
      for (const g of geo.groups) {
        if (PANEL_MATERIAL_RE.test(materialName(mats[g.materialIndex ?? 0]))) pushMeshTriangles(mesh, loose, g.start, g.count);
      }
    } else if (PANEL_MATERIAL_RE.test(materialName(mats[0]))) {
      pushMeshTriangles(mesh, loose);
    }
  });
  if (loose.length) connectedComponents(loose).forEach((tris) => found.push({ name: "Panel", tris }));
  if (!found.length) found.push(...detectByShape(root));

  const panels = found
    .map((f): Omit<Panel, "index"> | null => { const b = buildPanel(f.name, f.tris); return b ? { ...b, path: f.path } : null; })
    .filter((p): p is Omit<Panel, "index"> => !!p)
    // Stable numbering: north → south, then west → east.
    .sort((a, b) => (Math.abs(a.center.z - b.center.z) > 0.5 ? a.center.z - b.center.z : a.center.x - b.center.x));
  return panels.map((p, index) => ({ ...p, index }));
}


// ---------------------------------------------------------------- node addresses & tags

/** Address of a node as child indices from the root, e.g. "0.3.12". Stable for the same file + loader. */
export function nodePath(root: THREE.Object3D, node: THREE.Object3D): string {
  const parts: number[] = [];
  let n: THREE.Object3D | null = node;
  while (n && n !== root) {
    const parent: THREE.Object3D | null = n.parent;
    if (!parent) break;
    parts.unshift(parent.children.indexOf(n));
    n = parent;
  }
  return parts.join(".");
}

export function nodeAtPath(root: THREE.Object3D, path: string): THREE.Object3D | null {
  if (path === "") return root;
  let n: THREE.Object3D | undefined = root;
  for (const i of path.split(".").map(Number)) {
    n = n?.children[i];
    if (!n) return null;
  }
  return n ?? null;
}

export function nodeTriangles(node: THREE.Object3D): number[] {
  const tris: number[] = [];
  collectMeshes(node).forEach((m) => pushMeshTriangles(m, tris));
  return tris;
}

function panelsFromTags(root: THREE.Object3D, tags: PanelTag[]): Panel[] {
  const out: Omit<Panel, "index">[] = [];
  for (const t of tags) {
    const node = nodeAtPath(root, t.path);
    if (!node) continue;
    const b = buildPanel(t.name || nodeName(node) || "Panel", nodeTriangles(node));
    if (b) out.push({ ...b, wp: t.wp, path: t.path });
  }
  return out
    .sort((a, b) => (Math.abs(a.center.z - b.center.z) > 0.5 ? a.center.z - b.center.z : a.center.x - b.center.x))
    .map((p, index) => ({ ...p, index }));
}

// ---------------------------------------------------------------- panels.json (processing → viewer)

const r4 = (a: ArrayLike<number>) => Array.from(a, (x) => Math.round(x * 1e4) / 1e4);

export interface PanelsFile {
  version: 1;
  panels: { name: string; wp?: number; path?: string; area: number; normal: number[]; center: number[]; tris: number[]; triNormals: number[]; samples: number[]; sampleNormals: number[] }[];
}

export function serializePanels(panels: Panel[]): PanelsFile {
  return {
    version: 1,
    panels: panels.map((p) => ({
      name: p.name, wp: p.wp, path: p.path, area: Math.round(p.area * 1e4) / 1e4,
      normal: r4(p.normal.toArray()), center: r4(p.center.toArray()),
      tris: r4(p.tris), triNormals: r4(p.triNormals), samples: r4(p.samples), sampleNormals: r4(p.sampleNormals),
    })),
  };
}

export function deserializePanels(f: PanelsFile): Panel[] {
  return f.panels.map((p, index) => ({
    index, name: p.name, wp: p.wp, path: p.path, area: p.area,
    normal: new THREE.Vector3().fromArray(p.normal), center: new THREE.Vector3().fromArray(p.center),
    tris: new Float32Array(p.tris), triNormals: new Float32Array(p.triNormals),
    samples: new Float32Array(p.samples), sampleNormals: new Float32Array(p.sampleNormals),
  }));
}

/** Panel rating written in a name, e.g. "Solar Panel 615Wp#3" or "WAAREE_550W_Module" → 615 / 550. */
export function wpFromName(name: string): number | null {
  const m = name.match(/(\d{3,4})\s*_?w(?:p)?(?![a-z])/i);
  const v = m ? Number(m[1]) : NaN;
  return v >= 100 && v <= 1000 ? v : null;
}
