"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { SlotPicker } from "@/components/meet/SlotPicker";
import { JitsiCall } from "@/components/meet/JitsiCall";
import { formatIST } from "@/lib/time";

export interface TeamMeeting {
  id: string; startsAt: string; endsAt: string; status: string; designer: string; notes: string | null;
  room: string; joinUrl: string; joinable: boolean; upcoming: boolean;
}

export function MeetingsCard({ projectId, meetings, domain, me, canBook }: { projectId: string; meetings: TeamMeeting[]; domain: string; me: string; canBook: boolean }) {
  const router = useRouter();
  const [picker, setPicker] = useState<{ mode: "book" } | { mode: "reschedule"; id: string } | null>(null);
  const [call, setCall] = useState<TeamMeeting | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const close = useCallback(() => setCall(null), []);

  async function act(id: string, body: object) {
    const r = await fetch(`/api/team/meetings/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Saved" : j.error ?? "Failed");
    router.refresh();
  }
  async function pick(start: string) {
    if (!picker) return;
    if (picker.mode === "book") {
      const r = await fetch(`/api/team/projects/${projectId}/meetings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? "Meeting booked — the customer has been notified." : j.error ?? "Failed");
    } else await act(picker.id, { action: "reschedule", start });
    setPicker(null);
    router.refresh();
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Meetings</h2>
        {canBook && <button className="text-xs font-semibold text-brand-700" onClick={() => setPicker(picker ? null : { mode: "book" })}>+ Book</button>}
      </div>
      {picker && <div className="mt-3"><SlotPicker endpoint={`/api/team/projects/${projectId}/meetings`} onPick={pick} /></div>}
      {meetings.length === 0 && !picker && <p className="mt-2 text-sm text-gray-500">No meetings yet. The customer can book from their link.</p>}
      <ul className="mt-2 space-y-3">
        {meetings.map((m) => (
          <li key={m.id} className={`rounded-lg p-2.5 text-sm ring-1 ${m.upcoming ? "ring-violet-200" : "ring-gray-200"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{formatIST(m.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST</div>
                <div className="text-xs text-gray-500">{m.designer} · {m.status.toLowerCase()}</div>
              </div>
              {m.status === "BOOKED" && (m.joinable
                ? <button className="btn-primary px-3 py-1 text-xs" onClick={() => setCall(m)}>Join call</button>
                : <a className="text-xs text-gray-500 underline" href={m.joinUrl} target="_blank" rel="noreferrer">Room link</a>)}
            </div>
            {m.status === "BOOKED" && (
              <div className="mt-1 flex gap-3 text-xs">
                <button className="text-brand-700" onClick={() => setPicker({ mode: "reschedule", id: m.id })}>Reschedule</button>
                <button className="text-red-600" onClick={() => confirm("Cancel this meeting? The customer will be notified.") && act(m.id, { action: "cancel" })}>Cancel</button>
                {!m.upcoming && <button className="text-gray-600" onClick={() => act(m.id, { action: "complete" })}>Mark done</button>}
              </div>
            )}
            {(m.status !== "CANCELLED") && (
              <div className="mt-2">
                <textarea className="input text-xs" rows={2} placeholder="Meeting notes (what the customer asked for)…" defaultValue={m.notes ?? ""} onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} />
                {notes[m.id] !== undefined && notes[m.id] !== (m.notes ?? "") && (
                  <button className="mt-1 text-xs font-semibold text-brand-700" onClick={() => act(m.id, { action: "notes", notes: notes[m.id] })}>Save notes</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
      {call && <JitsiCall floating domain={domain} room={call.room} joinUrl={call.joinUrl} displayName={`${me} (Evergreen Solar)`} onClose={close} />}
    </section>
  );
}
