// Finds the solar panels in a SketchUp export and prepares sample points on each panel's
// top (sun-facing) surface for shading analysis.
//
// Naming convention for the design team (see README):
//   • Each panel is a SketchUp Component/Group whose name contains "Solar Panel" / "PV Module"
//     (e.g. "Solar Panel 550W"), OR
//   • the panel glass uses a material whose name contains "Solar Panel" / "PV Glass" / "Solar Cell".
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export const PANEL_NODE_RE = /(solar[\s_-]*(pv[\s_-]*)?(panel|module)|pv[\s_-]*(panel|module)|^(panel|module)(\b|_|\d|#))/i;
export const PANEL_MATERIAL_RE = /(solar[\s_-]*(panel|cell|glass|module)|pv[\s_-]*(cell|glass|module|panel))/i;

/** Groups bigger than this (m² of top surface) that contain several matching children are split. */
const MAX_SINGLE_PANEL_AREA = 3.6;
export const SAMPLES_PER_PANEL = 64;

export interface Panel {
  index: number;
  name: string;
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
const nameMatches = (o: THREE.Object3D) => PANEL_NODE_RE.test(o.userData?.name ?? "") || PANEL_NODE_RE.test(o.name ?? "");

function materialName(m: THREE.Material | undefined) {
  return m ? `${m.name ?? ""} ${(m.userData as { name?: string })?.name ?? ""}` : "";
}

function collectMeshes(node: THREE.Object3D): THREE.Mesh[] {
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

export function detectPanels(root: THREE.Object3D): Panel[] {
  root.updateMatrixWorld(true);
  const found: { name: string; tris: number[] }[] = [];
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
        found.push({ name: nodeName(node), tris });
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

  const panels = found
    .map((f) => buildPanel(f.name, f.tris))
    .filter((p): p is Omit<Panel, "index"> => !!p)
    // Stable numbering: north → south, then west → east.
    .sort((a, b) => (Math.abs(a.center.z - b.center.z) > 0.5 ? a.center.z - b.center.z : a.center.x - b.center.x));
  return panels.map((p, index) => ({ ...p, index }));
}
