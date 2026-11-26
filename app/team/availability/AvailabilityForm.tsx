"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

export function AvailabilityForm({ userId, slotMinutes, weekly, leave }: {
  userId: string; slotMinutes: number;
  weekly: { weekday: number; startMinute: number; endMinute: number }[];
  leave: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() => DAYS.map((_, d) => {
    const w = weekly.find((x) => x.weekday === d);
    return { on: !!w, start: toHM(w?.startMinute ?? 660), end: toHM(w?.endMinute ?? 1140) };
  }));
  const [slot, setSlot] = useState(slotMinutes);
  const [msg, setMsg] = useState<string | null>(null);
  const [lv, setLv] = useState({ date: "", toDate: "", fromHour: "", toHour: "", reason: "" });

  async function save() {
    const r = await fetch("/api/team/availability", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, slotMinutes: slot, weekly: rows.map((r, d) => ({ weekday: d, startMinute: toMin(r.start), endMinute: toMin(r.end), on: r.on })).filter((r) => r.on).map(({ on: _o, ...x }) => x) }),
    });
    setMsg(r.ok ? "Working hours saved." : "Could not save.");
  }
  async function addLeave() {
    if (!lv.date) return;
    const r = await fetch("/api/team/availability", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, date: lv.date, toDate: lv.toDate || undefined, fromHour: lv.fromHour ? Number(lv.fromHour) : undefined, toHour: lv.toHour ? Number(lv.toHour) : undefined, reason: lv.reason || undefined }),
    });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Leave added." : j.error ?? "Could not add leave.");
    setLv({ date: "", toDate: "", fromHour: "", toHour: "", reason: "" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className="font-semibold">Weekly working hours (IST)</h2>
        <div className="mt-3 space-y-2">
          {rows.map((r, d) => (
            <div key={d} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-32 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={r.on} onChange={(e) => setRows(rows.map((x, i) => (i === d ? { ...x, on: e.target.checked } : x)))} />{DAYS[d]}</label>
              <input type="time" className="input w-32 py-1.5" disabled={!r.on} value={r.start} onChange={(e) => setRows(rows.map((x, i) => (i === d ? { ...x, start: e.target.value } : x)))} />
              <span>to</span>
              <input type="time" className="input w-32 py-1.5" disabled={!r.on} value={r.end} onChange={(e) => setRows(rows.map((x, i) => (i === d ? { ...x, end: e.target.value } : x)))} />
            </div>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">Meeting length
          <select className="input w-auto py-1.5" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
        <button className="btn-primary mt-4" onClick={save}>Save working hours</button>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Leave & blocked time</h2>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-5">
          <label>From date<input type="date" className="input py-1.5" value={lv.date} onChange={(e) => setLv({ ...lv, date: e.target.value })} /></label>
          <label>To date (optional)<input type="date" className="input py-1.5" value={lv.toDate} onChange={(e) => setLv({ ...lv, toDate: e.target.value })} /></label>
          <label>From hour (blank = whole day)<input className="input py-1.5" inputMode="decimal" placeholder="e.g. 14" value={lv.fromHour} onChange={(e) => setLv({ ...lv, fromHour: e.target.value })} /></label>
          <label>To hour<input className="input py-1.5" inputMode="decimal" placeholder="e.g. 16" value={lv.toHour} onChange={(e) => setLv({ ...lv, toHour: e.target.value })} /></label>
          <label>Reason<input className="input py-1.5" value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} /></label>
        </div>
        <button className="btn-secondary mt-3" disabled={!lv.date} onClick={addLeave}>Add leave</button>
        <ul className="mt-3 space-y-1 text-sm">
          {leave.length === 0 && <li className="text-gray-500">No leave planned.</li>}
          {leave.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5">
              <span>{l.label}</span>
              <button className="text-xs text-red-600" onClick={async () => { await fetch(`/api/team/timeoff/${l.id}`, { method: "DELETE" }); router.refresh(); }}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
    </div>
  );
}
