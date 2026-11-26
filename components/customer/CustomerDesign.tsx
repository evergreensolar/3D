"use client";
// Customer design page: the 3D viewer plus "Talk to a designer" (booking, joining the video call
// on the same screen, reschedule / cancel) and "Approve design" (video + OTP).
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DesignViewer, type DesignViewerProps } from "@/components/viewer/DesignViewer";
import { SlotPicker } from "@/components/meet/SlotPicker";
import { JitsiCall } from "@/components/meet/JitsiCall";
import { ApprovalFlow } from "./ApprovalFlow";
import { formatIST } from "@/lib/time";

export interface CustomerMeeting { id: string; startsAt: string; endsAt: string; designer: string; room: string; joinUrl: string; joinable: boolean }

export function CustomerDesign({ viewer, token, versionId, versionNumber, consent, approvedAt, meeting, video, customerName }: {
  viewer: DesignViewerProps;
  token: string;
  versionId: string;
  versionNumber: number;
  consent: string;
  approvedAt: string | null;
  meeting: CustomerMeeting | null;
  video: { domain: string };
  customerName: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "book" | "approve">("none");
  const [call, setCall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const closeCall = useCallback(() => setCall(false), []);

  async function book(start: string) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/p/${token}/meetings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? "Could not book"); return; }
    setPanel("none");
    setMsg(`Booked for ${formatIST(j.meeting.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST with ${j.meeting.designer}. A confirmation is on its way.`);
    router.refresh();
  }
  async function cancel() {
    if (!confirm("Cancel this meeting?")) return;
    await fetch(`/api/p/${token}/meetings`, { method: "DELETE" });
    setMsg("Meeting cancelled.");
    router.refresh();
  }

  const topBar = (
    <div className="space-y-2 border-b border-gray-200 bg-gray-50 p-3">
      {approvedAt ? (
        <div className="rounded-xl bg-green-50 p-3 text-sm text-green-800 ring-1 ring-green-200">✅ <b>You approved Version {versionNumber}</b> on {formatIST(approvedAt)}. Thank you!</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary px-2" onClick={() => setPanel(panel === "book" ? "none" : "book")}>📅 {meeting ? "Reschedule" : "Talk to a designer"}</button>
          <button className="btn-primary px-2" onClick={() => setPanel("approve")}>✅ Approve design</button>
        </div>
      )}
      {meeting && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2.5 text-sm ring-1 ring-violet-200">
          <span className="min-w-0 flex-1">🎥 Meeting with <b>{meeting.designer}</b><br /><span className="text-xs text-gray-600">{formatIST(meeting.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST</span></span>
          {meeting.joinable ? (
            <button className="btn-primary px-3 py-1.5" onClick={() => setCall(true)}>Join call</button>
          ) : <span className="text-xs text-gray-500">Join opens 15 min before</span>}
          <button className="text-xs text-red-600" onClick={cancel}>Cancel</button>
        </div>
      )}
      {panel === "book" && (
        <div className="rounded-xl bg-white p-3 ring-1 ring-gray-200">
          <p className="mb-2 text-sm font-semibold">Pick a time for a video call with our designer</p>
          <SlotPicker endpoint={`/api/p/${token}/slots`} onPick={book} busy={busy} />
        </div>
      )}
      {msg && <p className="text-xs text-gray-700">{msg}</p>}
    </div>
  );

  return (
    <>
      <DesignViewer
        {...viewer}
        topBar={topBar}
        overlay={call && meeting ? <JitsiCall domain={video.domain} room={meeting.room} joinUrl={meeting.joinUrl} displayName={customerName} onClose={closeCall} /> : null}
      />
      {panel === "approve" && !approvedAt && (
        <ApprovalFlow token={token} versionId={versionId} versionNumber={versionNumber} consent={consent}
          onClose={() => setPanel("none")} onDone={() => { setPanel("none"); router.refresh(); }} />
      )}
    </>
  );
}
