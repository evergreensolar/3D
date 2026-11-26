// Turns a Studio design into a 3D model — the same kind of scene a SketchUp export gives, with
// panels named "Solar Panel <Wp>Wp#n" so the rest of the pipeline (shading, generation, PDF,
// customer viewer) treats it exactly like an uploaded model.
import * as THREE from "three";
import type { Design, Obstacle } from "./types";
import { roofHeight } from "./types";
import { activePanels, frame } from "./layout";

const D2R = Math.PI / 180;
const mat = (name: string, color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ name, color, roughness: 0.9, ...extra });

export function buildDesignScene(d: Design): THREE.Group {
  const M = {
    wall: mat("Wall", "#efe3c8"),
    roof: mat("Roof", "#b9b4aa"),
    parapet: mat("Parapet", "#f4f1ea"),
    stair: mat("Stair_Room", "#e7dcc4"),
    tank: mat("Water_Tank", "#1f2937"),
    neighbour: mat("Neighbour_Building", "#d9c7a5"),
    trunk: mat("Tree_Trunk", "#7c5a3a"),
    leaves: mat("Tree_Leaves", "#3f7d3a"),
    steel: mat("GI_Structure", "#9ca3af", { metalness: 0.6, roughness: 0.4 }),
    glass: mat("Solar_Panel_Glass", "#1e3a8a", { roughness: 0.25, metalness: 0.2 }),
    frame: mat("Panel_Frame_Aluminium", "#d1d5db", { metalness: 0.7, roughness: 0.35 }),
  };
  const scene = new THREE.Group();
  scene.name = "Evergreen Studio Design";
  const top = roofHeight(d);
  const poly = d.building.outline;

  if (poly.length >= 3) {
    // Building: extrude the outline (shape in x / −z so +y extrusion maps correctly after rotation)
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: top, bevelEnabled: false }), M.wall);
    body.rotation.x = -Math.PI / 2;
    body.name = "Building";
    scene.add(body);
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false }), M.roof);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = top - 0.15 + 0.001;
    slab.name = "Roof_Slab";
    scene.add(slab);
    // Parapet walls along each edge
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
  }

  d.obstacles.forEach((o) => scene.add(buildObstacle(o, o.onRoof ? top : 0, M)));

  // Panels + simple elevated structure
  const a = d.array;
  const panels = activePanels(d);
  const { f, r } = frame(a.azimuth);
  const across = a.orientation === "portrait" ? a.panelW : a.panelL;
  const slope = a.orientation === "portrait" ? a.panelL : a.panelW;
  const tilt = a.tilt * D2R;
  const rise = slope * Math.sin(tilt);
  const array = new THREE.Group();
  array.name = "PV_Array";
  const structure = new THREE.Group();
  structure.name = "GI_Structure";
  panels.forEach((p, i) => {
    const g = new THREE.Group();
    g.name = `Solar Panel ${a.wp}Wp#${i + 1}`;
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(across, a.thickness, slope), M.frame);
    frameMesh.name = "frame";
    const glass = new THREE.Mesh(new THREE.BoxGeometry(across - 0.04, 0.004, slope - 0.04), M.glass);
    glass.name = "glass";
    glass.position.y = a.thickness / 2;
    g.add(frameMesh, glass);
    g.rotation.order = "YXZ";
    g.rotation.y = Math.PI - a.azimuth * D2R; // local +z → facing direction
    g.rotation.x = tilt; // raise the back edge
    g.position.set(p.center[0], top + a.structureHeight + rise / 2 + 0.05, p.center[1]);
    array.add(g);
    // legs: front (low) and back (high) at both ends of the panel
    const half = (slope * Math.cos(tilt)) / 2 - 0.1;
    for (const s of [-1, 1]) {
      for (const [dv, h] of [[half, a.structureHeight], [-half, a.structureHeight + rise]] as const) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), M.steel);
        leg.position.set(p.center[0] + r[0] * s * (across / 2 - 0.08) + f[0] * dv, top + h / 2, p.center[1] + r[1] * s * (across / 2 - 0.08) + f[1] * dv);
        leg.name = "Leg";
        structure.add(leg);
      }
    }
  });
  array.add(structure);
  scene.add(array);
  scene.updateMatrixWorld(true);
  return scene;
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
