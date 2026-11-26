// Diagnostic: which geometry blocks the sun for each panel at a given time. Usage:
//   npx tsx scripts/diag-shading.ts <model.glb> <lat> <lng> <month> <day> <hour>
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { detectPanels, SAMPLES_PER_PANEL } from "@/lib/scene/panels";
import { ShadingEngine } from "@/lib/scene/shading";
import { sunState, SIM_YEAR } from "@/lib/scene/sun";
import { istDate } from "@/lib/time";

const [file, lat, lng, month, day, hour] = process.argv.slice(2);
const buf = readFileSync(file);
new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (gltf) => {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const panels = detectPanels(root);
  const engine = new ShadingEngine(root, panels);
  const sun = sunState(istDate(SIM_YEAR, +month, +day, +hour), +lat, +lng, 0);
  console.log(`panels=${panels.length} sun alt=${sun.altitudeDeg.toFixed(1)} az=${sun.azimuthDeg.toFixed(1)}`);
  const fr = engine.panelShading(sun.direction);
  // name the blocking mesh via a plain raycast
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const rc = new THREE.Raycaster();
  for (const p of panels) {
    const hits = new Map<string, number>();
    for (let s = 0; s < SAMPLES_PER_PANEL; s++) {
      const n = new THREE.Vector3().fromArray(p.sampleNormals, s * 3);
      const o = new THREE.Vector3().fromArray(p.samples, s * 3).addScaledVector(n, 0.02);
      rc.set(o, new THREE.Vector3(...sun.direction));
      const h = rc.intersectObjects(meshes, false)[0];
      if (h) { const k = `${h.object.parent?.name}/${h.object.name}`; hits.set(k, (hits.get(k) ?? 0) + 1); }
    }
    console.log(`#${p.index} ${p.name} ${(fr[p.index] * 100).toFixed(0)}% area=${p.area.toFixed(2)} n=(${p.normal.toArray().map((x) => x.toFixed(2))})`, Object.fromEntries(hits));
  }
}, (e) => console.error(e));
