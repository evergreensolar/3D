import type { Project, DesignVersion } from "@prisma/client";
import { addressCustomer } from "@/lib/notify/address";
import { formatIST } from "@/lib/time";
import { compassPoint } from "@/lib/scene/sun";
import type { Layout } from "@/lib/scene/layout";

export const kwLabel = (p: Pick<Project, "systemSizeKw">) => (p.systemSizeKw ? `${p.systemSizeKw} kW` : "Size pending");

export function panelLabel(p: Pick<Project, "panelCount" | "panelWattage" | "panelMake" | "panelModel">) {
  const make = [p.panelMake, p.panelModel].filter(Boolean).join(" ");
  const rating = p.panelWattage ? `${p.panelWattage} Wp` : "";
  const count = p.panelCount ? `${p.panelCount} × ` : "";
  return `${count}${rating}${make ? ` · ${make}` : ""}` || "—";
}

export function layoutLines(l: Layout | null | undefined) {
  if (!l || !l.panelCount) return [];
  return [
    { label: "Panel tilt & direction", value: `${l.tiltDeg}° facing ${compassPoint(l.azimuthDeg)} (${l.azimuthDeg}°)` },
    { label: "Structure", value: l.structureHeightM !== null ? `${l.structureType}, ≈${l.structureHeightM} m clear height` : l.structureType },
  ];
}

export function projectDetails(p: Project, v?: DesignVersion | null) {
  return [
    { label: "Customer", value: addressCustomer(p) },
    { label: "Address", value: p.address },
    { label: "System size", value: p.systemSizeKw ? `${p.systemSizeKw} kWp` : "Calculated after processing" },
    { label: "Panels", value: panelLabel(p) },
    ...layoutLines(v?.layout as Layout | null | undefined),
    ...(v ? [{ label: "Design version", value: `Version ${v.number}${v.processedAt ? ` · ${formatIST(v.processedAt, { dateStyle: "medium" })}` : ""}` }] : []),
  ];
}
