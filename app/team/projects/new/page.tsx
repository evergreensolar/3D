import { requireTeamUser } from "@/lib/auth/session";
import { listDesigners } from "@/lib/team";
import { ProjectForm, type ProjectFormValues } from "@/components/ProjectForm";

export const metadata = { title: "New project" };

// Fields can be pre-filled from the URL, e.g. when opened from the ERP:
// /team/projects/new?customerName=Amit%20Roy&customerMobile=9830012345&address=...&latitude=22.57&longitude=88.36&panelWattage=550
const PREFILL: (keyof ProjectFormValues)[] = [
  "customerSalutation", "customerName", "customerMobile", "customerEmail", "address", "latitude", "longitude",
  "northOffsetDeg", "panelWattage", "panelMake", "panelModel",
];

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireTeamUser(["ADMIN", "DESIGNER"]);
  const q = await searchParams;
  const designers = await listDesigners();
  const initial: Partial<ProjectFormValues> = { designerId: user.role === "DESIGNER" ? user.id : "" };
  for (const k of PREFILL) if (typeof q[k] === "string") initial[k] = q[k]!.slice(0, 500);
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">New project — upload design</h1>
      <ProjectForm mode="create" designers={designers} initial={initial} />
    </main>
  );
}
