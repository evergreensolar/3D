import type { ShadingSummary } from "@/lib/scene/shading";

export interface SnapshotMeta {
  name: string;
  label: string;
  kind: "view" | "shading";
  month?: number;
  hour?: number;
  shadedPct?: number;
  shadedPanels?: number;
}

export interface ProcessingInput {
  modelUrl: string;
  format: "GLB" | "DAE" | "ZIP";
  lat: number;
  lng: number;
  northOffsetDeg: number;
}

/** What the browser-side processor produces (images as JPEG data URLs, converted model as an ArrayBuffer). */
export interface ProcessingOutput {
  glb?: ArrayBuffer;
  snapshots: (SnapshotMeta & { dataUrl: string })[];
  summary: ShadingSummary;
  panelCount: number;
  bbox: { min: number[]; max: number[] };
  log: string[];
}
