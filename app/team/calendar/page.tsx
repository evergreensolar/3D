import Link from "next/link";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { formatIST, IST_OFFSET_MIN } from "@/lib/time";
import { joinableNow } from "@/lib/meetings";
import { videoProvider } from "@/lib/video";

export const metadata = { title: "Calendar" };

/** Day / week view of design meetings. Designers see their own; admins see everyone (filter by designer). */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; designer?: string; view?: string }> }) {
  const user = await requireTeamUser();
  const q = await searchParams;
  const offset = Number(q.week ?? 0) || 0;
  const dayView = q.view === "day";
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const startDay = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + offset * (dayView ? 1 : 7)) - IST_OFFSET_MIN * 60_000);
  const days = dayView ? 1 : 7;
  const end = new Date(startDay.getTime() + days * 86_400_000);
  const seeAll = user.role !== "DESIGNER";
  const designers = seeAll ? await db.user.findMany({ where: { active: true, role: { in: ["DESIGNER", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const designerId = seeAll ? q.designer || undefined : user.id;
  const meetings = await db.meeting.findMany({
    where: { startsAt: { gte: startDay, lt: end }, status: { not: "CANCELLED" }, ...(designerId ? { designerId } : {}) },
    orderBy: { startsAt: "asc" },
    include: { project: { select: { id: true, code: true, customerName: true, address: true } }, designer: { select: { name: true } } },
  });
  const video = videoProvider();
  const link = (o: Record<string, string | number | undefined>) =>
    "/team/calendar?" + new URLSearchParams(Object.entries({ week: offset, designer: q.designer, view: q.view, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className="btn-secondary px-3 py-1.5" href={link({ week: offset - 1 })}>←</Link>
          <Link className="btn-secondary px-3 py-1.5" href={link({ week: 0 })}>{dayView ? "Today" : "This week"}</Link>
          <Link className="btn-secondary px-3 py-1.5" href={link({ week: offset + 1 })}>→</Link>
          <Link className="btn-ghost px-3 py-1.5" href={link({ view: dayView ? undefined : "day", week: 0 })}>{dayView ? "Week view" : "Day view"}</Link>
          {seeAll && (
            <form className="flex gap-1">
              <input type="hidden" name="week" value={offset} />
              {q.view && <input type="hidden" name="view" value={q.view} />}
              <select name="designer" defaultValue={q.designer ?? ""} className="input w-auto py-1.5 text-sm">
                <option value="">All designers</option>
                {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button className="btn-secondary px-3 py-1.5">Show</button>
            </form>
          )}
        </div>
      </div>
      <div className={`mt-4 grid gap-3 ${dayView ? "" : "sm:grid-cols-2 lg:grid-cols-7"}`}>
        {Array.from({ length: days }, (_, i) => {
          const d0 = new Date(startDay.getTime() + i * 86_400_000), d1 = new Date(d0.getTime() + 86_400_000);
          const list = meetings.filter((m) => m.startsAt >= d0 && m.startsAt < d1);
          return (
            <div key={i} className="card min-h-32 p-2">
              <div className="mb-2 text-xs font-semibold text-gray-600">{formatIST(new Date(d0.getTime() + 3_600_000), { weekday: "short", day: "numeric", month: "short" })}</div>
              {list.length === 0 && <p className="text-xs text-gray-400">—</p>}
              <ul className="space-y-2">
                {list.map((m) => (
                  <li key={m.id} className={`rounded-lg p-2 text-xs ring-1 ${m.status === "BOOKED" ? "bg-violet-50 ring-violet-200" : "bg-gray-50 ring-gray-200"}`}>
                    <div className="font-semibold">{formatIST(m.startsAt, { hour: "numeric", minute: "2-digit" })} – {formatIST(m.endsAt, { hour: "numeric", minute: "2-digit" })}</div>
                    <Link className="text-brand-700 hover:underline" href={`/team/projects/${m.project.id}`}>{m.project.code} · {m.project.customerName}</Link>
                    {seeAll && <div className="text-gray-500">{m.designer.name}</div>}
                    {m.status === "BOOKED" && joinableNow(m) && <a className="mt-1 inline-block font-semibold text-violet-700 underline" href={`/team/projects/${m.project.id}`}>Join from project page</a>}
                    {m.status !== "BOOKED" && <div className="text-gray-500">{m.status.toLowerCase()}</div>}
                    <a className="block truncate text-gray-400" href={video.joinUrl(m.roomName)} target="_blank" rel="noreferrer">room link</a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </main>
  );
}
