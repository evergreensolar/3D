import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { formatIST } from "@/lib/time";
import { AvailabilityForm } from "./AvailabilityForm";

export const metadata = { title: "Availability" };

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const me = await requireTeamUser();
  const q = await searchParams;
  const userId = me.role === "ADMIN" && q.user ? q.user : me.id;
  const [u, people] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, include: { availability: true, timeOff: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } } } }),
    me.role === "ADMIN" ? db.user.findMany({ where: { active: true, role: { in: ["DESIGNER", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Availability — {u.name}</h1>
        {people.length > 1 && (
          <form className="flex gap-1">
            <select name="user" defaultValue={userId} className="input w-auto py-1.5 text-sm">{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button className="btn-secondary px-3 py-1.5">Show</button>
          </form>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-500">Customers can book meetings only inside these hours, for the next 14 days. Booked meetings and leave are never double-booked.</p>
      <AvailabilityForm key={u.id} userId={u.id} slotMinutes={u.slotMinutes}
        weekly={u.availability.map((a) => ({ weekday: a.weekday, startMinute: a.startMinute, endMinute: a.endMinute }))}
        leave={u.timeOff.map((t) => ({ id: t.id, label: `${formatIST(t.startsAt)} → ${formatIST(t.endsAt)}${t.reason ? ` · ${t.reason}` : ""}` }))} />
    </main>
  );
}
