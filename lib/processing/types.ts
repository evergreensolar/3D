import type { ShadingSummary } from "@/lib/scene/shading";
import type { EnergyEstimate } from "@/lib/energy/model";
import type { Layout } from "@/lib/scene/layout";
import type { PanelTag, PanelsFile } from "@/lib/scene/panels";

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
  /** Designer-tagged panels, if any. */
  tags?: PanelTag[] | null;
  /** Project's panel rating, used for panels without their own Wp. */
  defaultWp?: number | null;
}

/** What the browser-side processor produces (images as JPEG data URLs, converted model as an ArrayBuffer). */
export interface ProcessingOutput {
  glb?: ArrayBuffer;
  snapshots: (SnapshotMeta & { dataUrl: string })[];
  summary: ShadingSummary;
  energy: EnergyEstimate;
  layout: Layout;
  panelCount: number;
  /** Sum of panel ratings (Wp); null when the rating is unknown. */
  totalWp: number | null;
  /** Exact panel geometry for the viewer. */
  panelsFile: PanelsFile;
  bbox: { min: number[]; max: number[] };
  log: string[];
}
