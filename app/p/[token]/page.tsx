import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/config";
import { hasCustomerSession } from "@/lib/auth/session";
import { latestReadyVersion } from "@/lib/projects";
import { storage } from "@/lib/storage";
import { maskMobile } from "@/lib/validation";
import { addressCustomer } from "@/lib/notify/address";
import { Logo } from "@/components/Logo";
import { CustomerDesign } from "@/components/customer/CustomerDesign";
import { consentText } from "@/lib/approval";
import { videoProvider } from "@/lib/video";
import { joinableNow } from "@/lib/meetings";
import type { ShadingSummary } from "@/lib/scene/shading";
import type { EnergyEstimate } from "@/lib/energy/model";
import type { Measure } from "@/components/viewer/Scene3D";
import { OtpGate } from "./OtpGate";
import { projectDetails } from "@/lib/details";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your solar design", referrer: "no-referrer" };

export default async function CustomerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isConfigured()) notFound();
  const project = await db.project.findUnique({ where: { shareToken: token } });
  if (!project) notFound();

  if (!(await hasCustomerSession(project))) {
    return <OtpGate token={token} maskedMobile={maskMobile(project.customerMobile)} />;
  }

  const version = await latestReadyVersion(project.id);
  if (!version?.modelKey) {
    return (
      <main className="flex min-h-full items-center justify-center p-6 text-center">
        <div className="card max-w-sm p-6">
          <Logo />
          <p className="mt-4 font-semibold">Dear {addressCustomer(project)},</p>
          <p className="mt-2 text-sm text-gray-600">Your 3D design is being prepared. Please check again in a few minutes.</p>
        </div>
      </main>
    );
  }
  const modelUrl = await storage().getUrl(version.modelKey, { expiresInSec: 6 * 3600 });
  const meeting = await db.meeting.findFirst({
    where: { projectId: project.id, status: "BOOKED", endsAt: { gt: new Date(Date.now() - 30 * 60_000) } },
    orderBy: { startsAt: "asc" }, include: { designer: { select: { name: true } } },
  });
  const approval = await db.approval.findFirst({ where: { versionId: version.id }, orderBy: { approvedAt: "desc" } });
  const video = videoProvider();
  const panelsUrl = version.panelsKey ? await storage().getUrl(version.panelsKey, { expiresInSec: 6 * 3600 }) : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <Logo className="text-sm" />
        <div className="min-w-0 text-right">
          <div className="truncate text-sm font-semibold">{project.systemSizeKw ? `${project.systemSizeKw} kW · ` : ""}{project.code}</div>
          <div className="text-xs text-gray-500">Design Version {version.number}{version.lockedAt ? " · ✅ Approved" : ""}</div>
        </div>
      </header>
      <div className="border-b border-brand-100 bg-brand-50 px-4 py-1.5 text-xs text-gray-700">
        Namaskar {addressCustomer(project)} — pick any month and time to see the sun and shadows on your roof.
      </div>
      <div className="min-h-0 flex-1">
        <CustomerDesign
          token={token}
          versionId={version.id}
          versionNumber={version.number}
          consent={consentText(project, version.number)}
          approvedAt={approval?.approvedAt.toISOString() ?? null}
          customerName={project.customerName}
          video={{ domain: video.domain }}
          meeting={meeting ? {
            id: meeting.id, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), designer: meeting.designer.name,
            room: video.roomForApi(meeting.roomName), joinUrl: video.joinUrl(meeting.roomName), joinable: joinableNow(meeting),
          } : null}
          viewer={{
            modelUrl, panelsUrl,
            annotations: version.annotations as unknown as Measure[] | null,
            lat: project.latitude, lng: project.longitude, northOffsetDeg: project.northOffsetDeg,
            summary: version.shadingSummary as unknown as ShadingSummary | null,
            energy: version.energyEstimate as unknown as EnergyEstimate | null,
            kwp: project.systemSizeKw,
            details: projectDetails(project, version),
            reportUrl: version.reportKey ? `/api/p/${token}/report` : undefined,
            comments: { endpoint: `/api/p/${token}/comments`, team: false, locked: !!version.lockedAt },
          }}
        />
      </div>
    </div>
  );
}
