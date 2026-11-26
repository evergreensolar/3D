import { requireTeamUser } from "@/lib/auth/session";
import { listDesigners } from "@/lib/team";
import { ProjectForm } from "@/components/ProjectForm";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const user = await requireTeamUser(["ADMIN", "DESIGNER"]);
  const designers = await listDesigners();
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">New project — upload design</h1>
      <ProjectForm mode="create" designers={designers} initial={{ designerId: user.role === "DESIGNER" ? user.id : "" }} />
    </main>
  );
}
