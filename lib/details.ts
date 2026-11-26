import type { Project, DesignVersion } from "@prisma/client";
import { addressCustomer } from "@/lib/notify/address";
import { formatIST } from "@/lib/time";

export function projectDetails(p: Project, v?: DesignVersion | null) {
  return [
    { label: "Customer", value: addressCustomer(p) },
    { label: "Address", value: p.address },
    { label: "System size", value: `${p.systemSizeKw} kWp` },
    { label: "Panels", value: `${p.panelCount} × ${p.panelMake} ${p.panelModel}${p.panelWattage ? ` (${p.panelWattage} W)` : ""}` },
    { label: "Structure", value: `${p.structureType}, ${p.structureHeightM} m` },
    ...(v ? [{ label: "Design version", value: `Version ${v.number}${v.processedAt ? ` · ${formatIST(v.processedAt, { dateStyle: "medium" })}` : ""}` }] : []),
  ];
}
