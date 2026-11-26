import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { listDesigners } from "@/lib/team";
import { ProjectForm } from "@/components/ProjectForm";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTeamUser(["ADMIN", "DESIGNER"]);
  const { id } = await params;
  const p = await db.project.findUnique({ where: { id } });
  if (!p) notFound();
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-xl font-semibold">Edit {p.code}</h1>
      <p className="mb-4 text-sm text-gray-500">Changing the location, north rotation or panel rating re-processes the latest version (new shading and PDF).</p>
      <ProjectForm
        mode="edit" projectId={p.id} designers={await listDesigners()}
        initial={{
          customerSalutation: p.customerSalutation, customerName: p.customerName, customerMobile: p.customerMobile, customerEmail: s(p.customerEmail),
          address: p.address, latitude: s(p.latitude), longitude: s(p.longitude), northOffsetDeg: s(p.northOffsetDeg),
          panelMake: s(p.panelMake), panelModel: s(p.panelModel), panelWattage: s(p.panelWattage), designerId: s(p.designerId),
        }}
      />
    </main>
  );
}
