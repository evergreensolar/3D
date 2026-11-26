// Turns a Studio design into a 3D model — the same kind of scene a SketchUp export gives, with
// panels named "Solar Panel <Wp>Wp#n" so the pipeline (shading, generation, PDF, viewer) treats it
// exactly like an uploaded model and reads each panel's rating from its name.
import * as THREE from "three";
import { ShapeUtils } from "three";
import type { Design, LibraryBlock, Obstacle, ParamBlock, TemplateMeta } from "./types";
import { roofHeight } from "./types";
import { frame, libraryCopies, paramGeometry, paramPanels, roofTopAt } from "./layout";
import { nodeAtPath } from "@/lib/scene/panels";

const D2R = Math.PI / 180;
const mat = (name: string, color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ name, color, roughness: 0.9, ...extra });

/** Loaded library models by template id (already normalised: footprint centre at 0, base at y = 0). */
export type LibraryModels = Record<string, { meta: TemplateMeta; object: THREE.Object3D }>;

export function buildDesignScene(d: Design, lib: LibraryModels = {}): THREE.Group {
  const M = {
    wall: mat("Wall", "#efe3c8"), roof: mat("Roof", "#b9b4aa"), parapet: mat("Parapet", "#f4f1ea"),
    stair: mat("Stair_Room", "#e7dcc4"), tank: mat("Water_Tank", "#1f2937"), neighbour: mat("Neighbour_Building", "#d9c7a5"),
    trunk: mat("Tree_Trunk", "#7c5a3a"), leaves: mat("Tree_Leaves", "#3f7d3a"),
    steel: mat("GI_Structure", "#9ca3af", { metalness: 0.6, roughness: 0.4 }),
    glass: mat("Solar_Panel_Glass", "#1e3a8a", { roughness: 0.25, metalness: 0.2 }),
    frame: mat("Panel_Frame_Aluminium", "#d1d5db", { metalness: 0.7, roughness: 0.35 }),
  };
  const scene = new THREE.Group();
  scene.name = "Evergreen Studio Design";
  const top = roofHeight(d);
  const poly = d.building.outline;
  const sloped = d.building.roof.type === "mono";

  if (poly.length >= 3) {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: top, bevelEnabled: false }), M.wall);
    body.rotation.x = -Math.PI / 2;
    body.name = "Building";
    scene.add(body);
    if (!sloped) {
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false }), M.roof);
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = top - 0.15 + 0.001;
      slab.name = "Roof_Slab";
      scene.add(slab);
      if (d.building.parapet > 0) {
        const par = new THREE.Group();
        par.name = "Parapet";
        for (let i = 0; i < poly.length; i++) {
          const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
          const len = Math.hypot(x2 - x1, z2 - z1);
          if (len < 0.05) continue;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, d.building.parapet, 0.2), M.parapet);
          wall.position.set((x1 + x2) / 2, top + d.building.parapet / 2, (z1 + z2) / 2);
          wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
          wall.name = `Parapet_${i + 1}`;
          par.add(wall);
        }
        scene.add(par);
      }
    } else {
      // single-slope roof surface + gable walls up to it
      const h = poly.map((p) => roofTopAt(d, p));
      const tris = ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const pos: number[] = [];
      tris.forEach(([a, b, c]) => [a, b, c].forEach((k) => pos.push(poly[k][0], h[k] + 0.12, poly[k][1])));
      const walls: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const [ax, az] = poly[i], [bx, bz] = poly[j];
        walls.push(ax, top, az, bx, top, bz, bx, h[j], bz, ax, top, az, bx, h[j], bz, ax, h[i], az);
      }
      const mk = (arr: number[], m: THREE.Material, name: string) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, m);
        mesh.name = name;
        return mesh;
      };
      const roofMat = M.roof.clone();
      roofMat.side = THREE.DoubleSide;
      const wallMat = M.wall.clone();
      wallMat.side = THREE.DoubleSide;
      scene.add(mk(pos, roofMat, "Sloped_Roof"), mk(walls, wallMat, "Gable_Walls"));
    }
  }

  d.obstacles.forEach((o) => scene.add(buildObstacle(o, o.onRoof ? roofTopAt(d, [o.x, o.z]) : 0, M)));

  const array = new THREE.Group();
  array.name = "PV_Array";
  let n = 0;
  for (const b of d.blocks) {
    if (b.kind === "param") n = addParamBlock(array, d, b, M, n);
    else n = addLibraryBlock(array, d, b, lib, n);
  }
  scene.add(array);
  scene.updateMatrixWorld(true);
  return scene;
}

function addParamBlock(parent: THREE.Group, d: Design, b: ParamBlock, M: Record<string, THREE.Material>, n: number) {
  const g = paramGeometry(b);
  const { f, r } = frame(b.facing);
  const tilt = b.tilt * D2R;
  const rise = g.slope * Math.sin(tilt);
  const block = new THREE.Group();
  block.name = `Structure_${b.rows}x${b.cols}`;
  for (const p of paramPanels(b)) {
    if (p.removed) continue;
    const base = roofTopAt(d, p.center);
    const panel = new THREE.Group();
    panel.name = `Solar Panel ${b.wp}Wp#${++n}`;
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(g.across, 0.035, g.slope), M.frame);
    frameMesh.name = "frame";
    const glass = new THREE.Mesh(new THREE.BoxGeometry(g.across - 0.04, 0.004, g.slope - 0.04), M.glass);
    glass.name = "glass";
    glass.position.y = 0.0175;
    panel.add(frameMesh, glass);
    panel.rotation.order = "YXZ";
    panel.rotation.y = Math.PI - b.facing * D2R;
    panel.rotation.x = tilt;
    panel.position.set(p.center[0], base + b.height + rise / 2 + 0.05, p.center[1]);
    block.add(panel);
    if (b.height > 0.25) {
      const half = g.depth / 2 - 0.1;
      for (const s of [-1, 1]) {
        for (const [dv, h] of [[half, b.height], [-half, b.height + rise]] as const) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), M.steel);
          leg.position.set(p.center[0] + r[0] * s * (g.across / 2 - 0.08) + f[0] * dv, base + h / 2, p.center[1] + r[1] * s * (g.across / 2 - 0.08) + f[1] * dv);
          leg.name = "Leg";
          block.add(leg);
        }
      }
    }
  }
  parent.add(block);
  return n;
}

function addLibraryBlock(parent: THREE.Group, d: Design, b: LibraryBlock, lib: LibraryModels, n: number) {
  const item = lib[b.templateId];
  if (!item) return n;
  const { meta, object } = item;
  for (const c of libraryCopies(b, meta)) {
    const copy = object.clone(true);
    // rename the modules so processing recognises them and their rating
    copy.updateMatrixWorld(true);
    for (const path of meta.panelPaths) {
      const node = nodeAtPath(copy, path);
      if (node) node.name = `Solar Panel ${meta.wp}Wp#${++n}`;
    }
    const inner = new THREE.Group();
    inner.add(copy);
    inner.position.set(-meta.cx, -meta.minY, -meta.cz);
    const outer = new THREE.Group();
    outer.name = meta.name.replace(/\s+/g, "_");
    outer.add(inner);
    outer.position.set(c.x, roofTopAt(d, [c.x, c.z]), c.z);
    outer.rotation.y = -b.rot * D2R;
    parent.add(outer);
  }
  return n;
}

function buildObstacle(o: Obstacle, base: number, M: Record<string, THREE.Material>) {
  const g = new THREE.Group();
  g.name = o.name.replace(/\s+/g, "_");
  g.position.set(o.x, base, o.z);
  g.rotation.y = -o.rot * D2R;
  if (o.kind === "tank") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(o.w / 2, o.w / 2, o.h, 32), M.tank);
    m.position.y = o.h / 2;
    g.add(m);
  } else if (o.kind === "tree") {
    const trunkH = o.h * 0.7;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, trunkH, 12), M.trunk);
    trunk.position.y = trunkH / 2;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(o.w / 2, 20, 12), M.leaves);
    crown.scale.y = Math.max(0.4, (o.h - trunkH) / o.w + 0.2);
    crown.position.y = trunkH + (o.w / 2) * crown.scale.y * 0.6;
    g.add(trunk, crown);
  } else {
    const material = o.kind === "neighbour" ? M.neighbour : o.kind === "stair" ? M.stair : M.wall;
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), material);
    m.position.y = o.h / 2;
    g.add(m);
  }
  return g;
}
