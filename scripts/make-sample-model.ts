// Generates public/samples/sample-rooftop.glb — a typical Kolkata G+2 house with an elevated
// GI structure carrying 12 × 550 W panels (6.6 kW), a stair room ("mumty") with an overhead
// water tank, parapet walls, a taller neighbouring building to the west and a coconut tree to the
// south-east. Built the way a SketchUp export looks: Y-up, metres, −Z = north, panels as
// components named "Solar Panel 550W#n".
//
// Run: npm run sample:model
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { writeFileSync, mkdirSync } from "node:fs";

// GLTFExporter uses FileReader for binary output; Node has Blob but no FileReader.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) {
    b.arrayBuffer().then((r) => { this.result = `data:${b.type};base64,${Buffer.from(r).toString("base64")}`; this.onloadend?.(); });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

const mat = (name: string, color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ name, color, roughness: 0.9, metalness: 0, ...extra });

const M = {
  wall: mat("Wall_Cream", "#efe3c8"),
  roof: mat("Roof_Concrete", "#b9b4aa"),
  parapet: mat("Parapet_White", "#f4f1ea"),
  neighbour: mat("Neighbour_Wall", "#d9c7a5"),
  window: mat("Window_Glass", "#5b7fa3", { transparent: true, opacity: 0.35 }),
  frame: mat("GI_Structure", "#9ca3af", { metalness: 0.6, roughness: 0.4 }),
  panelGlass: mat("Solar_Panel_Glass", "#1e3a8a", { roughness: 0.25, metalness: 0.2 }),
  panelFrame: mat("Panel_Frame_Aluminium", "#d1d5db", { metalness: 0.7, roughness: 0.35 }),
  tank: mat("Water_Tank_Black", "#1f2937"),
  trunk: mat("Tree_Trunk", "#7c5a3a"),
  leaves: mat("Tree_Leaves", "#3f7d3a"),
  door: mat("Door_Wood", "#8b5e3c"),
};

function box(name: string, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.name = name;
  m.position.set(x, y + h / 2, z); // y = base height
  return m;
}

const scene = new THREE.Scene();
scene.name = "Evergreen Sample Rooftop";

// ---------- House: 10 m (E–W) × 12 m (N–S), roof slab at 9.15 m
const W = 10, D = 12, H = 9;
const house = new THREE.Group(); house.name = "House_G+2";
house.add(box("Building", W, H, D, M.wall, 0, 0, 0));
house.add(box("Roof_Slab", W + 0.3, 0.15, D + 0.3, M.roof, 0, H, 0));
const roofTop = H + 0.15;
for (let f = 0; f < 3; f++) {
  for (let i = -1; i <= 1; i++) {
    house.add(box(`Window_S_${f}_${i}`, 1.4, 1.3, 0.05, M.window, i * 3, f * 3 + 1, D / 2 + 0.01));
    house.add(box(`Window_E_${f}_${i}`, 0.05, 1.3, 1.4, M.window, W / 2 + 0.01, f * 3 + 1, i * 3.5));
  }
}
house.add(box("Main_Door", 1.2, 2.2, 0.06, M.door, 3.5, 0, D / 2 + 0.02));
scene.add(house);

// ---------- Parapet 1.0 m
const P = 1.0, T = 0.2;
const parapet = new THREE.Group(); parapet.name = "Parapet";
parapet.add(box("Parapet_S", W + 0.3, P, T, M.parapet, 0, roofTop, D / 2 + 0.05));
parapet.add(box("Parapet_N", W + 0.3, P, T, M.parapet, 0, roofTop, -D / 2 - 0.05));
parapet.add(box("Parapet_E", T, P, D + 0.3, M.parapet, W / 2 + 0.05, roofTop, 0));
parapet.add(box("Parapet_W", T, P, D + 0.3, M.parapet, -W / 2 - 0.05, roofTop, 0));
scene.add(parapet);

// ---------- Stair room (mumty) on the north-east with a 1000 L tank on top
const mumty = new THREE.Group(); mumty.name = "Stair_Room";
mumty.add(box("Stair_Room_Walls", 3.2, 2.7, 3.6, M.wall, 3.1, roofTop, -3.9));
mumty.add(box("Stair_Room_Slab", 3.4, 0.12, 3.8, M.roof, 3.1, roofTop + 2.7, -3.9));
const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 32), M.tank);
tank.name = "Water_Tank_1000L";
tank.position.set(3.1, roofTop + 2.82 + 0.65, -3.9);
mumty.add(tank);
scene.add(mumty);

// ---------- Elevated GI structure: 2 rows × 6 panels, portrait, 15° tilt facing south
const PW = 1.134, PL = 2.278, PT = 0.035, TILT = (15 * Math.PI) / 180;
const legH = 2.1; // structure height above roof (front/lower edge)
const array = new THREE.Group(); array.name = "PV_Array_Structure";
const rowsZ = [1.15, 4.05]; // row centres (north row first)
const x0 = -4.2;
let n = 0;
const structure = new THREE.Group(); structure.name = "GI_Elevated_Structure";
for (const zc of rowsZ) {
  const run = PL * Math.cos(TILT);
  const rise = PL * Math.sin(TILT);
  const yLow = roofTop + legH;
  for (let i = 0; i < 6; i++) {
    const xc = x0 + PW / 2 + i * (PW + 0.02);
    const panel = new THREE.Group();
    panel.name = `Solar Panel 550W#${++n}`;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.04, 0.004, PL - 0.04), M.panelGlass);
    glass.name = "glass";
    glass.position.y = PT / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PW, PT, PL), M.panelFrame);
    frame.name = "frame";
    panel.add(frame, glass);
    panel.rotation.x = TILT; // raise the north edge → faces south (+Z)
    panel.position.set(xc, yLow + rise / 2 + 0.06, zc);
    array.add(panel);
  }
  // purlins + rafters + legs
  const span = 6 * (PW + 0.02);
  const xMid = x0 + span / 2;
  for (const [dz, dy] of [[run / 2 - 0.2, 0.05], [-run / 2 + 0.2, rise - 0.05]] as const) {
    structure.add(box("Purlin", span, 0.06, 0.06, M.frame, xMid, yLow + dy - 0.02, zc + dz));
  }
  for (let k = 0; k <= 3; k++) {
    const xl = x0 + 0.1 + k * ((span - 0.2) / 3);
    const front = box("Leg_Front", 0.08, legH, 0.08, M.frame, xl, roofTop, zc + run / 2 - 0.2);
    const back = box("Leg_Back", 0.08, legH + rise - 0.1, 0.08, M.frame, xl, roofTop, zc - run / 2 + 0.2);
    structure.add(front, back);
  }
}
array.add(structure);
scene.add(array);

// ---------- Neighbour to the west: G+3, 14 m tall, 2.5 m gap
scene.add(box("Neighbour_Building_West", 8, 14, 13, M.neighbour, -W / 2 - 2.5 - 4, 0, 0.5));

// ---------- Coconut tree to the south-east
const tree = new THREE.Group(); tree.name = "Coconut_Tree";
const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 15, 12), M.trunk);
trunk.name = "Trunk"; trunk.position.y = 7.5;
const crown = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 10), M.leaves);
crown.name = "Crown"; crown.scale.set(1, 0.5, 1); crown.position.y = 15;
tree.add(trunk, crown);
tree.position.set(W / 2 + 3, 0, D / 2 + 3);
scene.add(tree);

scene.updateMatrixWorld(true);
const exporter = new GLTFExporter();
exporter.parse(
  scene,
  (glb) => {
    mkdirSync("public/samples", { recursive: true });
    writeFileSync("public/samples/sample-rooftop.glb", Buffer.from(glb as ArrayBuffer));
    console.log(`Wrote public/samples/sample-rooftop.glb (${n} panels, ${((glb as ArrayBuffer).byteLength / 1024).toFixed(0)} KB)`);
  },
  (err) => { console.error(err); process.exit(1); },
  { binary: true },
);
