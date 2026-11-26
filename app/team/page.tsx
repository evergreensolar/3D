import Link from "next/link";
import type { Prisma, ProjectStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { STATUS_LABEL, STATUS_STYLE, VERSION_STATUS_LABEL } from "@/lib/projects";
import { formatIST, istDate } from "@/lib/time";
import { kwLabel } from "@/lib/details";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

const ORDER: ProjectStatus[] = ["UPLOADED", "SENT_TO_CUSTOMER", "COMMENTS_PENDING", "MEETING_BOOKED", "REVISED", "APPROVED"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; designer?: string; from?: string; to?: string }> }) {
  const user = await requireTeamUser();
  const { q, status, designer, from, to } = await searchParams;
  const base: Prisma.ProjectWhereInput = {};
  if (designer) base.designerId = designer === "none" ? null : designer;
  const ymd = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").map(Number) : null);
  const f = ymd(from), t = ymd(to);
  if (f || t) base.createdAt = { ...(f ? { gte: istDate(f[0], f[1], f[2], 0) } : {}), ...(t ? { lt: istDate(t[0], t[1], t[2], 24) } : {}) };
  if (q) {
    // MySQL collation (utf8mb4_unicode_ci) is already case-insensitive.
    base.OR = [
      { customerName: { contains: q } }, { code: { contains: q } },
      { customerMobile: { contains: q.replace(/\D/g, "") || q } }, { address: { contains: q } },
    ];
  }
  const where: Prisma.ProjectWhereInput = { ...base, ...(status && status in STATUS_LABEL ? { status: status as ProjectStatus } : {}) };
  const [projects, counts, designers, upcoming] = await Promise.all([
    db.project.findMany({
      where, orderBy: { updatedAt: "desc" }, take: 300,
      include: { designer: { select: { name: true } }, versions: { orderBy: { number: "desc" }, take: 1 }, _count: { select: { comments: { where: { parentId: null, resolvedAt: null, authorType: "CUSTOMER" } } } } },
    }),
    db.project.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.user.findMany({ where: { active: true, role: { in: ["DESIGNER", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.meeting.findMany({
      where: { status: "BOOKED", endsAt: { gt: new Date() }, ...(user.role === "DESIGNER" ? { designerId: user.id } : {}) },
      orderBy: { startsAt: "asc" }, take: 8, include: { project: { select: { id: true, code: true, customerName: true } }, designer: { select: { name: true } } },
    }),
  ]);
  const count = (s: ProjectStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const total = counts.reduce((n, c) => n + c._count._all, 0);
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ q, status, designer, from, to, ...o }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Projects</h1>
        <form className="flex w-full flex-wrap gap-2 lg:w-auto">
          <input name="q" defaultValue={q} placeholder="Search name, code, mobile, address" className="input min-w-0 flex-1 lg:w-64" />
          <select name="designer" defaultValue={designer ?? ""} className="input w-auto">
            <option value="">All designers</option>
            <option value="none">Unassigned</option>
            {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="date" name="from" defaultValue={from} className="input w-auto" title="Created from" />
          <input type="date" name="to" defaultValue={to} className="input w-auto" title="Created to" />
          {status && <input type="hidden" name="status" value={status} />}
          <button className="btn-secondary">Filter</button>
        </form>
      </div>

      {/* pipeline */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Link href={qs({ status: undefined })} className={`chip shrink-0 ${!status ? "bg-gray-900 text-white ring-gray-900" : "bg-white ring-gray-300"}`}>All · {total}</Link>
        {ORDER.map((s, i) => (
          <Link key={s} href={qs({ status: s })} className={`chip shrink-0 ${status === s ? "ring-2 ring-gray-900" : ""} ${STATUS_STYLE[s]}`}>
            {i > 0 && <span className="mr-1 text-gray-400">→</span>}{STATUS_LABEL[s]} · {count(s)}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          {projects.length === 0 ? (
            <div className="card p-10 text-center text-gray-500">No projects match. <Link className="font-semibold text-brand-700" href="/team/projects/new">Create a project</Link>.</div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {projects.map((p) => {
                const v = p.versions[0];
                return (
                  <li key={p.id}>
                    <Link href={`/team/projects/${p.id}`} className="card block p-4 hover:ring-brand-500/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{p.customerName}</div>
                          <div className="text-xs text-gray-500">{p.code} · {kwLabel(p)}{p.panelCount ? ` · ${p.panelCount} panels` : ""}</div>
                        </div>
                        <span className={`chip ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                      </div>
                      <div className="mt-2 line-clamp-1 text-sm text-gray-600">{p.address}</div>
                      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                        <span>{v ? `v${v.number} · ${VERSION_STATUS_LABEL[v.status]}` : "No design yet"}{p._count.comments ? ` · 💬 ${p._count.comments} open` : ""}</span>
                        <span>{p.designer?.name ?? "Unassigned"} · {formatIST(p.updatedAt, { dateStyle: "medium" })}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <aside className="card h-fit p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Upcoming meetings</h2>
            <Link href="/team/calendar" className="text-xs font-semibold text-brand-700">Calendar →</Link>
          </div>
          {upcoming.length === 0 && <p className="mt-2 text-sm text-gray-500">None booked.</p>}
          <ul className="mt-2 space-y-2">
            {upcoming.map((m) => (
              <li key={m.id} className="rounded-lg bg-violet-50 p-2 text-xs">
                <div className="font-semibold">{formatIST(m.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
                <Link href={`/team/projects/${m.project.id}`} className="text-brand-700 hover:underline">{m.project.code} · {m.project.customerName}</Link>
                <div className="text-gray-500">{m.designer.name}</div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
