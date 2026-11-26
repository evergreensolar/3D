import { test } from "node:test";
import assert from "node:assert/strict";
import { newDesign, OBSTACLE_PRESETS } from "@/lib/design/types";
import { layoutPanels, activePanels, pointInPolygon } from "@/lib/design/layout";
import { buildDesignScene } from "@/lib/design/build3d";
import { detectPanels } from "@/lib/scene/panels";
import { measureLayout } from "@/lib/scene/layout";
import { ShadingEngine } from "@/lib/scene/shading";

function sample() {
  const d = newDesign(22.6, 88.4, 615);
  d.building.outline = [[-5, -6], [5, -6], [5, 6], [-5, 6]]; // 10 m × 12 m roof
  d.building.floors = 3;
  return d;
}

test("auto layout fills the roof inside the setback", () => {
  const d = sample();
  const panels = layoutPanels(d);
  assert.ok(panels.length >= 20, `placed ${panels.length}`);
  for (const p of panels) for (const c of p.corners) assert.ok(pointInPolygon(c, d.building.outline));
});

test("rooftop obstructions and manual removal take panels out", () => {
  const d = sample();
  const before = activePanels(d).length;
  d.obstacles.push({ ...OBSTACLE_PRESETS.stair, id: "s", x: 2, z: 0 });
  const withStair = activePanels(d).length;
  assert.ok(withStair < before, `${withStair} < ${before}`);
  d.array.removed = [layoutPanels(d)[0].key];
  assert.equal(activePanels(d).length, withStair - 1);
});

test("studio model goes through the normal pipeline unchanged", () => {
  const d = sample();
  d.array.tilt = 20;
  d.array.structureHeight = 1.8;
  const n = activePanels(d).length;
  const scene = buildDesignScene(d);
  const panels = detectPanels(scene);
  assert.equal(panels.length, n, "every placed panel is recognised");
  const layout = measureLayout(panels, new ShadingEngine(scene, panels), 0);
  assert.equal(layout.tiltDeg, 20);
  assert.equal(layout.azimuthDeg, 180);
  assert.ok(Math.abs(layout.structureHeightM! - 1.8) <= 0.25, `structure ${layout.structureHeightM}`);
});

test("east-facing layout faces east", () => {
  const d = sample();
  d.array.azimuth = 90;
  const panels = detectPanels(buildDesignScene(d));
  assert.ok(panels.length > 0);
  assert.ok(panels[0].normal.x > 0.2 && Math.abs(panels[0].normal.z) < 0.05, panels[0].normal.toArray().join(","));
});
