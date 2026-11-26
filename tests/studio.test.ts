import { test } from "node:test";
import assert from "node:assert/strict";
import { newDesign, newParamBlock, OBSTACLE_PRESETS } from "@/lib/design/types";
import { autoFillBlocks, blockIssues, designStats, migrateDesign, paramPanels, pointInPolygon, roofTopAt } from "@/lib/design/layout";
import { buildDesignScene } from "@/lib/design/build3d";
import { detectPanels, wpFromName } from "@/lib/scene/panels";
import { measureLayout } from "@/lib/scene/layout";
import { ShadingEngine } from "@/lib/scene/shading";
import { fmtLen, parseLen, fromFtIn } from "@/lib/design/units";

function sample() {
  const d = newDesign(22.6, 88.4, 615);
  d.building.outline = [[-5, -6], [5, -6], [5, 6], [-5, 6]]; // 10 m × 12 m roof
  d.building.floors = 3;
  return d;
}

test("feet-inches input and display", () => {
  assert.equal(fmtLen(fromFtIn(40, 6), "ft"), "40′ 6″");
  assert.ok(Math.abs(parseLen("40' 6\"", "ft")! - fromFtIn(40, 6)) < 1e-9);
  assert.ok(Math.abs(parseLen("40 6", "ft")! - fromFtIn(40, 6)) < 1e-9);
  assert.equal(parseLen("12.5m", "ft"), 12.5);
  assert.equal(parseLen("12.5", "m"), 12.5);
});

test("auto-fill creates blocks inside the roof; obstacles reduce them", () => {
  const d = sample();
  d.blocks = autoFillBlocks(d);
  const before = designStats(d, {}).panels;
  assert.ok(before >= 20, `placed ${before}`);
  for (const b of d.blocks) if (b.kind === "param") for (const p of paramPanels(b)) for (const c of p.corners) assert.ok(pointInPolygon(c, d.building.outline));
  d.obstacles.push({ ...OBSTACLE_PRESETS.stair, id: "s", x: 2, z: 0 });
  d.blocks = autoFillBlocks(d);
  assert.ok(designStats(d, {}).panels < before);
});

test("block outside the roof is flagged; +/- panels changes the count", () => {
  const d = sample();
  const b = newParamBlock(d.array, 0, 0, 2, 3);
  d.blocks = [b];
  assert.equal(designStats(d, {}).panels, 6);
  assert.deepEqual(blockIssues(d, b, {}), []);
  b.cols = 4; b.removed = ["0:0"];
  assert.equal(designStats(d, {}).panels, 7);
  b.x = 20;
  assert.ok(blockIssues(d, b, {}).includes("Goes outside the roof"));
});

test("studio model goes through the normal pipeline, with Wp from panel names", () => {
  const d = sample();
  d.array.tilt = 20;
  d.array.structureHeight = 1.8;
  d.blocks = [newParamBlock(d.array, 0, 0, 2, 3), { ...newParamBlock(d.array, 0, 4, 1, 2), wp: 550 }];
  const scene = buildDesignScene(d);
  const panels = detectPanels(scene);
  assert.equal(panels.length, 8);
  const wps = panels.map((p) => wpFromName(p.name)).sort();
  assert.deepEqual(wps.filter((w) => w === 550).length, 2);
  assert.deepEqual(wps.filter((w) => w === 615).length, 6);
  const layout = measureLayout(panels, new ShadingEngine(scene, panels), 0);
  assert.equal(layout.tiltDeg, 20);
  assert.equal(layout.azimuthDeg, 180);
  assert.ok(Math.abs(layout.structureHeightM! - 1.8) <= 0.25, `structure ${layout.structureHeightM}`);
});

test("east-facing block faces east; sloped roof rises up-slope", () => {
  const d = sample();
  d.blocks = [{ ...newParamBlock(d.array, 0, 0, 1, 3), facing: 90 }];
  const panels = detectPanels(buildDesignScene(d));
  assert.ok(panels[0].normal.x > 0.2 && Math.abs(panels[0].normal.z) < 0.05);
  d.building.roof = { type: "mono", slopeDeg: 10, downBearing: 180 }; // slopes down to the south
  assert.ok(roofTopAt(d, [0, -6]) > roofTopAt(d, [0, 6]), "north edge is higher");
  assert.ok(Math.abs(roofTopAt(d, [0, 6]) - 9) < 1e-9, "south (low) edge at wall height");
});

test("v1 designs are migrated", () => {
  const v1 = { version: 1, site: { lat: 1, lng: 2 }, building: { outline: [[-5, -6], [5, -6], [5, 6], [-5, 6]], floors: 2, floorHeight: 3, parapet: 1 }, obstacles: [], array: sample().array, inverter: null };
  const v2 = migrateDesign(v1);
  assert.equal(v2.version, 2);
  assert.ok(designStats(v2, {}).panels > 0);
  assert.equal(wpFromName("Solar Panel 615Wp#3 Solar_Panel_615Wp#3"), 615);
  assert.equal(wpFromName("WAAREE_550W_Module"), 550);
  assert.equal(wpFromName("Panel_frame"), null);
});

test("survey outline: rectangle sides, walk, edit a side", async () => {
  const { rectangle, edgesOf, walk, closingGap, setEdgeLength } = await import("@/lib/design/outline");
  const r = rectangle(10, 12);
  const e = edgesOf(r);
  assert.deepEqual(e.map((x) => Math.round(x.side)), [0, 90, 180, 270]); // north, east, south, west sides
  assert.deepEqual(e.map((x) => Math.round(x.length)), [10, 12, 10, 12]);
  const w = walk([0, 0], [{ bearing: 90, length: 10 }, { bearing: 180, length: 12 }, { bearing: 270, length: 10 }, { bearing: 0, length: 12 }]);
  assert.ok(closingGap(w) < 1e-9);
  const longer = setEdgeLength(r, 0, 11);
  assert.ok(Math.abs(edgesOf(longer)[0].length - 11) < 1e-9);
  assert.ok(Math.abs(edgesOf(longer)[1].length - 12) < 1e-9, "next side keeps its length");
});

test("rectangle stays a rectangle when a side changes", async () => {
  const { rectangle, edgesOf, setSideLength, isRectangle } = await import("@/lib/design/outline");
  const r = setSideLength(rectangle(12.19, 9.14), 0, 13.72);
  assert.ok(isRectangle(r));
  const e = edgesOf(r).map((x) => Math.round(x.length * 100) / 100);
  assert.deepEqual(e, [13.72, 9.14, 13.72, 9.14]);
});
