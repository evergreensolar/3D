// Generates public/samples/structure-2x3-550.glb — an example "structure with modules" for the
// Design Studio library: elevated GI structure, 2 rows × 3 modules (550 Wp, portrait, 15° tilt,
// 2.1 m clear height), facing south (+Z). Run: npx tsx scripts/make-sample-structure.ts
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { writeFileSync } from "node:fs";

class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

const steel = new THREE.MeshStandardMaterial({ name: "GI_Steel", color: "#9ca3af", metalness: 0.6, roughness: 0.4 });
const glass = new THREE.MeshStandardMaterial({ name: "Module_Glass", color: "#1e3a8a", roughness: 0.25 });
const alu = new THREE.MeshStandardMaterial({ name: "Module_Frame", color: "#d1d5db", metalness: 0.7, roughness: 0.35 });
const W = 1.134, L = 2.278, T = 0.035, tilt = (15 * Math.PI) / 180, H = 2.1;
const rise = L * Math.sin(tilt), run = L * Math.cos(tilt);
const root = new THREE.Group();
root.name = "Elevated GI 2x3";
let n = 0;
for (let row = 0; row < 2; row++) {
  const z = (row - 0.5) * (run + 0.05);
  for (let col = 0; col < 3; col++) {
    const x = (col - 1) * (W + 0.02);
    const m = new THREE.Group();
    m.name = `Module 550Wp#${++n}`;
    const f = new THREE.Mesh(new THREE.BoxGeometry(W, T, L), alu); f.name = "frame";
    const g = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.004, L - 0.04), glass); g.name = "glass"; g.position.y = T / 2;
    m.add(f, g);
    m.rotation.x = tilt;
    m.position.set(x, H + rise / 2 + 0.06, z);
    root.add(m);
  }
}
const frame = new THREE.Group();
frame.name = "GI_Frame";
const span = 3 * (W + 0.02);
for (const row of [0, 1]) {
  const z = (row - 0.5) * (run + 0.05);
  for (const [dz, h] of [[run / 2 - 0.15, H], [-run / 2 + 0.15, H + rise - 0.1]] as const) {
    const purlin = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.06), steel);
    purlin.position.set(0, h, z + dz);
    frame.add(purlin);
    for (const x of [-span / 2 + 0.05, 0, span / 2 - 0.05]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), steel);
      leg.position.set(x, h / 2, z + dz);
      frame.add(leg);
    }
  }
}
root.add(frame);
root.updateMatrixWorld(true);
new GLTFExporter().parse(root, (glb) => {
  writeFileSync("public/samples/structure-2x3-550.glb", Buffer.from(glb as ArrayBuffer));
  console.log(`Wrote public/samples/structure-2x3-550.glb (${n} modules)`);
}, (e) => { console.error(e); process.exit(1); }, { binary: true });
