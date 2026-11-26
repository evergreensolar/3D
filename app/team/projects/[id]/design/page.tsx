import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { listTemplates } from "@/lib/library";
import { DesignStudio } from "@/components/studio/DesignStudio";

export const metadata = { title: "Design Studio" };

// Satellite imagery: Esri World Imagery by default; set MAP_TILE_URL (with {z}/{x}/{y}) and
// MAP_ATTRIBUTION to use another provider (e.g. Mapbox or Google Map Tiles with your key).
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser(["ADMIN", "DESIGNER"]);
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) notFound();
  const last = await db.designVersion.findFirst({ where: { projectId: id, source: "studio" }, orderBy: { number: "desc" } });
  return (
    <DesignStudio
      projectId={project.id}
      projectCode={project.code}
      customerName={project.customerName}
      lat={project.latitude}
      lng={project.longitude}
      defaultWp={project.panelWattage ?? 550}
      initial={last?.designJson ?? null}
      templates={(await listTemplates()).map(({ description: _d, active: _a, ...t }) => t)}
      isAdmin={user.role === "ADMIN"}
      tileUrl={process.env.MAP_TILE_URL || TILE_URL}
      attribution={process.env.MAP_ATTRIBUTION || "Imagery © Esri, Maxar, Earthstar Geographics"}
    />
  );
}
