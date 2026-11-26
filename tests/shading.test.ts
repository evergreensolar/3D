import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { detectPanels } from "@/lib/scene/panels";
import { ShadingEngine } from "@/lib/scene/shading";
import { sunState, SIM_YEAR } from "@/lib/scene/sun";
import { istDate } from "@/lib/time";

const LAT = 22.6213, LNG = 88.4231;

async function loadSample(): Promise<THREE.Object3D> {
  const buf = readFileSync("public/samples/sample-rooftop.glb");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, "", (g) => res(g.scene), rej));
}

test("sample model: panel detection and shading", async () => {
  const root = await loadSample();
  root.updateMatrixWorld(true);
  const panels = detectPanels(root);
  assert.equal(panels.length, 12);
  for (const p of panels) {
    assert.ok(Math.abs(p.area - 2.45) < 0.05, `panel area ${p.area}`); // glass of a 1134×2278 mm module
    assert.ok(p.normal.z > 0.2 && p.normal.y > 0.9, "panels face south, tilted ~15°");
  }
  const engine = new ShadingEngine(root, panels);
  const at = (m: number, d: number, h: number) => engine.areaShadedPct(engine.panelShading(sunState(istDate(SIM_YEAR, m, d, h), LAT, LNG).direction));
  assert.equal(at(11, 21, 11), 0, "clear late-morning sun");
  assert.ok(at(12, 21, 15) > 5, "winter afternoon: neighbour building to the west shades the array");
  assert.equal(at(12, 21, 21), 100, "night counts as fully shaded");
  const s = engine.yearlySummary(LAT, LNG, 0);
  assert.equal(s.months.length, 12);
  const dec = s.months[11].shadedPct, jun = s.months[5].shadedPct;
  assert.ok(dec > jun, `winter (${dec}%) has more shade than summer (${jun}%)`);
});

test("sample model: layout measurement and generation estimate", async () => {
  const { measureLayout } = await import("@/lib/scene/layout");
  const { estimateEnergy } = await import("@/lib/energy/model");
  const root = await loadSample();
  root.updateMatrixWorld(true);
  const panels = detectPanels(root);
  const engine = new ShadingEngine(root, panels);
  const layout = measureLayout(panels, engine, 0);
  assert.equal(layout.tiltDeg, 15);
  assert.equal(layout.azimuthDeg, 180, "faces due south");
  assert.ok(layout.structureHeightM! >= 2.0 && layout.structureHeightM! <= 2.4, `structure ${layout.structureHeightM} m`);
  assert.equal(layout.structureType, "Elevated structure");

  const e = estimateEnergy({
    lat: LAT, lng: LNG, northOffsetDeg: 0,
    panels: panels.map((p) => ({ normal: [p.normal.x, p.normal.y, p.normal.z] as [number, number, number] })),
    shadeAt: (m, h) => engine.panelShading(sunState(istDate(SIM_YEAR, m, 21, h), LAT, LNG).direction),
  });
  // West Bengal: roughly 3.6–4.3 units per kWp per day
  assert.ok(e.annual.clean > 1300 && e.annual.clean < 1600, `clean ${e.annual.clean}`);
  assert.ok(e.annual.dirty < e.annual.clean && e.annual.clean <= e.annual.noShade, JSON.stringify(e.annual));
  assert.ok(e.annual.clean / e.annual.dirty > 1.04, "cleaning is worth several percent");
  assert.ok(e.months[3].clean > e.months[6].clean, "April generates more than monsoon July");
  assert.equal(e.profile[0][0], 0, "no output at 5 AM in January");
});
