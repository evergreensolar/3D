// A design drawn in the portal's Design Studio. Coordinates are metres in the model frame
// used everywhere else: x = east, z = south (north = −z), y = up; origin = the site lat/lng.
export type Pt = [number, number]; // [x, z]

export type ObstacleKind = "stair" | "tank" | "neighbour" | "tree" | "box";

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  name: string;
  x: number; // centre
  z: number;
  w: number; // east–west size (diameter for round ones)
  d: number; // north–south size
  h: number; // height above its base
  rot: number; // degrees, clockwise seen from above
  onRoof: boolean; // base on the roof (true) or on the ground
}

/** Defaults for new adjustable structure blocks (and the auto-fill). */
export interface ArraySpec {
  wp: number;
  panelL: number; // m, long side
  panelW: number; // m, short side
  thickness: number;
  orientation: "portrait" | "landscape";
  tilt: number; // degrees
  azimuth: number; // compass degrees the panels face (180 = south)
  structureHeight: number; // clear height under the lower edge (m)
  rowGap: number; // m between rows (in plan)
  colGap: number; // m between panels in a row
  setback: number; // m kept clear from the roof edge
  removed: string[]; // (v1 only)
}

export type RoofShape = { type: "flat" } | { type: "mono"; slopeDeg: number; downBearing: number };

/** Adjustable structure: rows × columns of panels on an elevated (or flush) structure. */
export interface ParamBlock {
  id: string;
  kind: "param";
  x: number; // centre
  z: number;
  facing: number; // compass bearing the panels face
  rows: number;
  cols: number;
  orientation: "portrait" | "landscape";
  tilt: number;
  height: number; // clear height under the lower edge
  wp: number;
  panelL: number;
  panelW: number;
  rowGap: number;
  colGap: number;
  removed: string[]; // "r:c"
}

/** A structure-with-modules model from the admin library, optionally repeated side by side. */
export interface LibraryBlock {
  id: string;
  kind: "library";
  templateId: string;
  x: number;
  z: number;
  rot: number; // degrees clockwise from the template's own orientation
  repeat: number; // copies side by side (along the template's width)
}

export type Block = ParamBlock | LibraryBlock;

export interface Design {
  version: 2;
  site: { lat: number; lng: number };
  units: "ft" | "m";
  building: { outline: Pt[]; floors: number; floorHeight: number; parapet: number; roof: RoofShape };
  obstacles: Obstacle[];
  blocks: Block[];
  array: ArraySpec;
  inverter: { name: string; kw: number } | null;
}

/** What the studio needs to know about a library template (stored with the template). */
export interface TemplateMeta {
  id: string;
  name: string;
  wp: number;
  panelCount: number;
  /** footprint in the template's own frame, metres (width along x, depth along z), and height */
  w: number;
  d: number;
  h: number;
  /** offset that puts the footprint centre at the origin and the base at y = 0 */
  cx: number;
  cz: number;
  minY: number;
  /** module rectangles in plan (centred frame) for drawing */
  modules: { x: number; z: number; w: number; d: number }[];
  /** node paths of the modules inside the model (renamed "Solar Panel <Wp>Wp" on export) */
  panelPaths: string[];
  modelUrl?: string;
  thumbUrl?: string;
}

export const OBSTACLE_PRESETS: Record<ObstacleKind, Omit<Obstacle, "id" | "x" | "z">> = {
  stair: { kind: "stair", name: "Stair room", w: 3, d: 3.5, h: 2.7, rot: 0, onRoof: true },
  tank: { kind: "tank", name: "Water tank", w: 1.2, d: 1.2, h: 1.4, rot: 0, onRoof: true },
  neighbour: { kind: "neighbour", name: "Neighbouring building", w: 8, d: 12, h: 12, rot: 0, onRoof: false },
  tree: { kind: "tree", name: "Tree", w: 4, d: 4, h: 10, rot: 0, onRoof: false },
  box: { kind: "box", name: "Obstruction", w: 1, d: 1, h: 1, rot: 0, onRoof: true },
};

const DEFAULT_ARRAY = (wp: number): ArraySpec => ({
  wp, panelL: 2.278, panelW: 1.134, thickness: 0.035, orientation: "portrait", tilt: 15, azimuth: 180,
  structureHeight: 2, rowGap: 0.6, colGap: 0.02, setback: 0.6, removed: [],
});

export function newDesign(lat: number, lng: number, wp: number): Design {
  return {
    version: 2,
    site: { lat, lng },
    units: "ft",
    building: { outline: [], floors: 2, floorHeight: 3, parapet: 1, roof: { type: "flat" } },
    obstacles: [],
    blocks: [],
    array: DEFAULT_ARRAY(wp),
    inverter: null,
  };
}

export const roofHeight = (d: Design) => d.building.floors * d.building.floorHeight;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newParamBlock(a: ArraySpec, x: number, z: number, rows = 2, cols = 3): ParamBlock {
  return {
    id: uid(), kind: "param", x, z, facing: a.azimuth, rows, cols, orientation: a.orientation, tilt: a.tilt,
    height: a.structureHeight, wp: a.wp, panelL: a.panelL, panelW: a.panelW, rowGap: 0.05, colGap: a.colGap, removed: [],
  };
}
