import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTeamUser } from "@/lib/auth/session";
import { STATUS_LABEL, STATUS_STYLE, VERSION_STATUS_LABEL } from "@/lib/projects";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { formatIST } from "@/lib/time";
import { projectDetails, kwLabel } from "@/lib/details";
import { addressCustomer } from "@/lib/notify/address";
import type { ShadingSummary } from "@/lib/scene/shading";
import type { EnergyEstimate } from "@/lib/energy/model";
import type { Measure } from "@/components/viewer/Scene3D";
import { DesignViewer } from "@/components/viewer/DesignViewer";
import { CopyLink, SendToCustomer, Reprocess } from "./ProjectActions";
import { BrowserProcessor } from "./BrowserProcessor";
import { UploadVersion } from "./UploadVersion";
import { fixedOtpCode } from "@/lib/auth/otp";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTeamUser();
  const { id } = await params;
  const p = await db.project.findUnique({
    where: { id },
    include: {
      designer: { select: { name: true } },
      versions: { orderBy: { number: "desc" }, include: { uploadedBy: { select: { name: true } } } },
      events: { orderBy: { createdAt: "desc" }, take: 12 },
      notifications: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!p) notFound();
  const latest = p.versions[0];
  const ready = p.versions.find((v) => v.status === "READY");
  const busy = latest && (latest.status === "QUEUED" || latest.status === "PROCESSING");
  const modelUrl = ready?.modelKey ? await storage().getUrl(ready.modelKey, { expiresInSec: 6 * 3600 }) : null;
  const panelsUrl = ready?.panelsKey ? await storage().getUrl(ready.panelsKey, { expiresInSec: 6 * 3600 }) : null;
  const link = `${env.appUrl}/p/${p.shareToken}`;
  const canEdit = user.role !== "SALES";
  const noPanels = ready?.detectedPanelCount === 0;

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500"><Link href="/team" className="hover:underline">Projects</Link> / {p.code}</div>
          <h1 className="text-xl font-semibold">{p.customerName} <span className="font-normal text-gray-500">· {kwLabel(p)}</span></h1>
          <div className="text-sm text-gray-500">{p.address}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`chip ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
          {canEdit && <Link href={`/team/projects/${p.id}/design`} className="btn-secondary">Design Studio</Link>}
          {canEdit && latest && <Link href={`/team/projects/${p.id}/panels`} className="btn-secondary">Tag panels</Link>}
          {canEdit && <Link href={`/team/projects/${p.id}/edit`} className="btn-secondary">Edit details</Link>}
        </div>
      </div>

      {busy && <BrowserProcessor key={latest.id} versionId={latest.id} />}
      {latest?.status === "FAILED" && (
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <b>Version {latest.number} could not be processed.</b> {latest.processingError}
          {canEdit && <div className="mt-2"><Reprocess projectId={p.id} versionId={latest.id} label="Try again" /></div>}
        </div>
      )}
      {noPanels && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <b>No solar panels were recognised in this model</b>, so the system size, shading and generation can&apos;t be calculated.
          {canEdit && <> <Link href={`/team/projects/${p.id}/panels`} className="font-semibold underline">Tag the panels yourself</Link> — click them in the model and enter their Wp.</>}
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card h-[78vh] min-h-[560px] overflow-hidden">
          {modelUrl && ready ? (
            <DesignViewer
              modelUrl={modelUrl}
              panelsUrl={panelsUrl}
              annotations={ready.annotations as unknown as Measure[] | null}
              annotateVersionId={canEdit ? ready.id : null}
              lat={p.latitude} lng={p.longitude} northOffsetDeg={p.northOffsetDeg}
              summary={ready.shadingSummary as unknown as ShadingSummary | null}
              energy={ready.energyEstimate as unknown as EnergyEstimate | null}
              kwp={p.systemSizeKw}
              details={projectDetails(p, ready)}
              reportUrl={`/api/team/versions/${ready.id}/report`}
            />
          ) : (
            p.versions.length === 0 && canEdit ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-base font-semibold">No design yet</p>
                <p className="max-w-sm text-sm text-gray-500">Design the system here on satellite imagery, or upload a model exported from SketchUp.</p>
                <Link href={`/team/projects/${p.id}/design`} className="btn-primary">Open Design Studio</Link>
                <div className="w-72"><UploadVersion projectId={p.id} label="Upload SketchUp model" /></div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">The 3D view appears here once processing finishes.</div>
            )
          )}
        </div>

        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="font-semibold">Share with customer</h2>
            <p className="mt-1 text-xs text-gray-500">Messages address the customer as &quot;{addressCustomer(p)}&quot;. They verify with an OTP on {p.customerMobile}.</p>
            {fixedOtpCode("SMS") && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                No SMS service is connected yet, so the customer&apos;s code is always <b>{fixedOtpCode("SMS")}</b>. Tell the customer when you share the link.
              </p>
            )}
            <div className="mt-3"><CopyLink url={link} /></div>
            <div className="mt-4"><SendToCustomer projectId={p.id} hasEmail={!!p.customerEmail} disabled={!ready} /></div>
            {p.sentToCustomerAt && <p className="mt-2 text-xs text-gray-500">Last sent {formatIST(p.sentToCustomerAt)}</p>}
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Report</h2>
            {ready?.reportKey ? (
              <div className="mt-3 flex gap-2">
                <a className="btn-primary flex-1" href={`/api/team/versions/${ready.id}/report`}>Download PDF</a>
                <a className="btn-secondary" href={`/api/team/versions/${ready.id}/report?view`} target="_blank" rel="noreferrer">Open</a>
              </div>
            ) : <p className="mt-2 text-sm text-gray-500">Not generated yet.</p>}
            {ready && (
              <p className="mt-2 text-xs text-gray-500">
                Version {ready.number} · {ready.detectedPanelCount} panels found in the model{p.systemSizeKw ? ` = ${p.systemSizeKw} kWp` : ""} · year-average shading {(ready.shadingSummary as unknown as ShadingSummary | null)?.annualPct ?? "–"}%
              </p>
            )}
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Versions</h2>
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {p.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">Version {v.number}</div>
                    <div className="text-xs text-gray-500">{v.originalFilename} · {v.uploadedBy.name} · {formatIST(v.createdAt, { dateStyle: "medium" })}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">{VERSION_STATUS_LABEL[v.status]}</span>
                    {canEdit && v.status === "READY" && !v.lockedAt && <Reprocess projectId={p.id} versionId={v.id} />}
                  </div>
                </li>
              ))}
            </ul>
            {canEdit && p.versions.length > 0 && p.status !== "APPROVED" && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <UploadVersion projectId={p.id} />
                <p className="mt-1 text-[11px] text-gray-400">Or open the Design Studio to change the design there. The customer link always shows the newest version.</p>
              </div>
            )}
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Activity</h2>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
              {[...p.events.map((e) => ({ at: e.createdAt, text: e.type.replace(".", " "), key: e.id })),
                ...p.notifications.map((n) => ({ at: n.createdAt, text: `${n.channel.toLowerCase()} ${n.template.replace("_", " ")} → ${n.status.toLowerCase()}${n.error ? ` (${n.error.slice(0, 60)})` : ""}`, key: n.id }))]
                .sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 14)
                .map((e) => (
                  <li key={e.key} className="flex justify-between gap-3">
                    <span>{e.text}</span>
                    <span className="shrink-0 text-gray-400">{formatIST(e.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-gray-400">Designer: {p.designer?.name ?? "Unassigned"}</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
