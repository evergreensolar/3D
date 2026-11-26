"use client";
// Free meeting slots for the next 14 days, grouped by day (IST).
import { useEffect, useState } from "react";
import { formatIST } from "@/lib/time";

export function SlotPicker({ endpoint, onPick, busy }: { endpoint: string; onPick: (start: string) => void; busy?: boolean }) {
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(endpoint).then((r) => r.json()).then((j) => { if (j.slots) setSlots(j.slots); else setError(j.error ?? "Could not load times"); }).catch(() => setError("Could not load times"));
  }, [endpoint]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!slots) return <p className="text-sm text-gray-500">Loading free times…</p>;
  if (!slots.length) return <p className="text-sm text-gray-600">No free times in the next 14 days. Please call us and we will arrange a meeting.</p>;
  const dayKey = (iso: string) => formatIST(iso, { weekday: "short", day: "numeric", month: "short" });
  const days = [...new Set(slots.map((s) => dayKey(s.start)))];
  const current = day ?? days[0];
  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => (
          <button key={d} onClick={() => setDay(d)} className={`chip shrink-0 ${current === d ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`}>{d}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.filter((s) => dayKey(s.start) === current).map((s) => (
          <button key={s.start} disabled={busy} onClick={() => onPick(s.start)} className="rounded-lg bg-white px-2 py-2 text-sm font-semibold ring-1 ring-gray-300 hover:ring-brand-500 disabled:opacity-50">
            {formatIST(s.start, { hour: "numeric", minute: "2-digit" })}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">Times are in IST. You will get a confirmation and reminders on WhatsApp / SMS.</p>
    </div>
  );
}
