import Link from "next/link";
import type { Prisma, ProjectStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { STATUS_LABEL, STATUS_STYLE, VERSION_STATUS_LABEL } from "@/lib/projects";
import { formatIST } from "@/lib/time";
import { kwLabel } from "@/lib/details";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireTeamUser();
  const { q, status } = await searchParams;
  const where: Prisma.ProjectWhereInput = {};
  if (status && status in STATUS_LABEL) where.status = status as ProjectStatus;
  if (q) {
    where.OR = [
      // MySQL collation (utf8mb4_unicode_ci) is already case-insensitive.
      { customerName: { contains: q } },
      { code: { contains: q } },
      { customerMobile: { contains: q.replace(/\D/g, "") || q } },
      { address: { contains: q } },
    ];
  }
  const projects = await db.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { designer: { select: { name: true } }, versions: { orderBy: { number: "desc" }, take: 1 } },
  });

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Projects</h1>
        <form className="flex w-full gap-2 sm:w-auto">
          <input name="q" defaultValue={q} placeholder="Search name, code, mobile, address" className="input sm:w-72" />
          <select name="status" defaultValue={status ?? ""} className="input w-auto">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-secondary">Filter</button>
        </form>
      </div>

      {projects.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-gray-500">No projects yet. <Link className="text-brand-700 font-semibold" href="/team/projects/new">Upload the first design</Link>.</div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    <span>{v ? `v${v.number} · ${VERSION_STATUS_LABEL[v.status]}` : "No version"}</span>
                    <span>{p.designer?.name ?? "Unassigned"} · {formatIST(p.updatedAt, { dateStyle: "medium" })}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
