import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { UsersAdmin } from "./UsersAdmin";

export const metadata = { title: "Team" };

export default async function UsersPage() {
  const me = await requireTeamUser(["ADMIN"]);
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true } });
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Team members</h1>
      <UsersAdmin users={users} meId={me.id} />
    </main>
  );
}
