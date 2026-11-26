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
  removed: string[]; // keys of auto-placed panels removed by the designer
}

export interface Design {
  version: 1;
  site: { lat: number; lng: number };
  building: { outline: Pt[]; floors: number; floorHeight: number; parapet: number };
  obstacles: Obstacle[];
  array: ArraySpec;
  inverter: { name: string; kw: number } | null;
}

export const OBSTACLE_PRESETS: Record<ObstacleKind, Omit<Obstacle, "id" | "x" | "z">> = {
  stair: { kind: "stair", name: "Stair room", w: 3, d: 3.5, h: 2.7, rot: 0, onRoof: true },
  tank: { kind: "tank", name: "Water tank", w: 1.2, d: 1.2, h: 1.4, rot: 0, onRoof: true },
  neighbour: { kind: "neighbour", name: "Neighbouring building", w: 8, d: 12, h: 12, rot: 0, onRoof: false },
  tree: { kind: "tree", name: "Tree", w: 4, d: 4, h: 10, rot: 0, onRoof: false },
  box: { kind: "box", name: "Obstruction", w: 1, d: 1, h: 1, rot: 0, onRoof: true },
};

export function newDesign(lat: number, lng: number, wp: number): Design {
  return {
    version: 1,
    site: { lat, lng },
    building: { outline: [], floors: 2, floorHeight: 3, parapet: 1 },
    obstacles: [],
    array: {
      wp, panelL: 2.278, panelW: 1.134, thickness: 0.035, orientation: "portrait", tilt: 15, azimuth: 180,
      structureHeight: 2, rowGap: 0.6, colGap: 0.02, setback: 0.6, removed: [],
    },
    inverter: null,
  };
}

export const roofHeight = (d: Design) => d.building.floors * d.building.floorHeight;
