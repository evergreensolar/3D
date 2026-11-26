import { requireTeamUser } from "@/lib/auth/session";
import { listTemplates } from "@/lib/library";
import { LibraryAdmin } from "./LibraryAdmin";

export const metadata = { title: "Structure library" };

export default async function LibraryPage() {
  await requireTeamUser(["ADMIN"]);
  const items = await listTemplates(true);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="text-xl font-semibold">Structure library</h1>
      <p className="mb-4 text-sm text-gray-500">Ready-made structures with modules. Designers drag them onto the roof in the Design Studio.</p>
      <LibraryAdmin items={items.map(({ id, name, wp, panelCount, w, d, h, thumbUrl, active, description }) => ({ id, name, wp, panelCount, w, d, h, thumbUrl, active, description }))} />
    </main>
  );
}
