"use client";
// Generation estimate: headline numbers, monthly bars (cleaned vs not cleaned — 2 series, legend +
// hover tooltip, selected month outlined), a typical-day output curve for the selected month with
// the current time marked, and a table view.
import { useState } from "react";
import type { EnergyEstimate } from "@/lib/energy/model";
import { MONTHS, formatHour } from "@/lib/time";

const CLEAN = "#2563eb";
const DIRTY = "#b45309";
const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

export function GenerationPanel({ energy, kwp, month, hour, onMonth }: {
  energy: EnergyEstimate;
  kwp: number | null;
  month: number;
  hour: number;
  onMonth: (m: number) => void;
}) {
  const k = kwp ?? 1;
  const unit = kwp ? "units" : "units per kWp";
  const yrClean = energy.annual.clean * k, yrDirty = energy.annual.dirty * k, yrFree = energy.annual.noShade * k;
  const m = energy.months[month - 1];

  return (
    <div className="space-y-5">
      {!kwp && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Panel rating not set — figures are per kWp.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Per year, cleaned regularly" value={fmt(yrClean)} unit={unit} strong />
        <Stat label="Per year, never cleaned" value={fmt(yrDirty)} unit={unit} note={`${fmt(yrClean - yrDirty)} less (−${(((yrClean - yrDirty) / yrClean) * 100).toFixed(0)}%)`} />
        <Stat label="Average per day" value={(yrClean / 365).toFixed(1)} unit={unit} />
        <Stat label="Lost to shade" value={fmt(yrFree - yrClean)} unit={`${unit}/yr`} note={yrFree > 0 ? `${(((yrFree - yrClean) / yrFree) * 100).toFixed(1)}% of possible` : undefined} />
      </div>

      <MonthlyBars energy={energy} k={k} month={month} onMonth={onMonth} />

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Typical day in {MONTHS[month - 1]}</h3>
          <span className="text-xs text-gray-500">{fmt((m.clean * k) / m.days)} {unit}/day</span>
        </div>
        <DayCurve energy={energy} k={k} month={month} hour={hour} />
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-gray-600">Show monthly table</summary>
        <table className="mt-2 w-full text-right tabular-nums">
          <thead className="text-gray-500">
            <tr><th className="text-left font-medium">Month</th><th className="font-medium">Cleaned</th><th className="font-medium">Not cleaned</th><th className="font-medium">Per day</th></tr>
          </thead>
          <tbody>
            {energy.months.map((x, i) => (
              <tr key={i} className={i % 2 ? "" : "bg-gray-50"}>
                <td className="text-left">{MONTHS[i]}</td><td>{fmt(x.clean * k)}</td><td>{fmt(x.dirty * k)}</td><td>{((x.clean * k) / x.days).toFixed(1)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="text-left">Year</td><td>{fmt(yrClean)}</td><td>{fmt(yrDirty)}</td><td>{(yrClean / 365).toFixed(1)}</td></tr>
          </tbody>
        </table>
      </details>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer text-gray-600">How this is estimated</summary>
        <p className="mt-2">{energy.method}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          <li>Cleaned: panels washed every 1–2 weeks ({energy.assumptions.soilingCleanPct}% dust loss).</li>
          <li>Not cleaned: dust loss {Math.min(...energy.assumptions.soilingDirtyPct)}–{Math.max(...energy.assumptions.soilingDirtyPct)}% by month (rain washes panels in the monsoon).</li>
          <li>Panel heat {energy.assumptions.tempCoeffPctPerC}%/°C, inverter {energy.assumptions.inverterEffPct}%, other losses {energy.assumptions.otherLossPct}%. Performance ratio {energy.performanceRatio}.</li>
          <li>Average weather; actual units vary year to year (±10%).</li>
        </ul>
      </details>
    </div>
  );
}

function Stat({ label, value, unit, note, strong }: { label: string; value: string; unit: string; note?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ring-1 ${strong ? "bg-brand-50 ring-brand-100" : "bg-white ring-gray-200"}`}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{value} <span className="text-xs font-normal text-gray-500">{unit}</span></div>
      {note && <div className="text-[11px] text-gray-500">{note}</div>}
    </div>
  );
}

function MonthlyBars({ energy, k, month, onMonth }: { energy: EnergyEstimate; k: number; month: number; onMonth: (m: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360, H = 170, L = 34, B = 18, T = 10;
  const pw = W - L - 4, ph = H - B - T;
  const max = Math.max(...energy.months.map((x) => x.clean * k));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const slot = pw / 12, bw = Math.min(9, slot * 0.36), gap = 2;
  const shown = hover ?? month - 1;
  const y = (v: number) => T + ph - (ph * v) / top;
  const bar = (x: number, v: number, fill: string) => {
    const h = (ph * v) / top, r = Math.min(3, h / 2, bw / 2), yy = T + ph - h;
    return <path d={`M${x},${T + ph} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${T + ph} Z`} fill={fill} />;
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Units by month</h3>
        <div className="flex gap-3 text-[11px] text-gray-600">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CLEAN }} />Cleaned</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DIRTY }} />Not cleaned</span>
        </div>
      </div>
      <div className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Monthly generation, cleaned versus not cleaned">
          {[0, step, 2 * step, 3 * step].filter((t) => t <= top).map((t) => (
            <g key={t}>
              <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#9ca3af" : "#e5e7eb"} />
              <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#6b7280">{fmt(t)}</text>
            </g>
          ))}
          {energy.months.map((x, i) => {
            const x0 = L + i * slot + (slot - (2 * bw + gap)) / 2;
            const sel = month === i + 1;
            return (
              <g key={i} opacity={shown === i || hover === null ? 1 : 0.6}>
                {bar(x0, x.clean * k, CLEAN)}
                {bar(x0 + bw + gap, x.dirty * k, DIRTY)}
                {sel && <rect x={x0 - 3} y={T - 2} width={2 * bw + gap + 6} height={ph + 4} rx={4} fill="none" stroke="#111827" strokeDasharray="2 2" />}
                <text x={x0 + bw + gap / 2} y={H - 5} textAnchor="middle" fontSize={9} fill={sel ? "#111827" : "#6b7280"} fontWeight={sel ? 700 : 400}>{MONTHS[i][0]}</text>
                <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onMonth(i + 1)} />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute -top-2 rounded-lg bg-gray-900 px-2 py-1 text-[11px] text-white shadow"
          style={{ left: `${((L + shown * slot + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
          {MONTHS[shown]}: <b>{fmt(energy.months[shown].clean * k)}</b> cleaned · {fmt(energy.months[shown].dirty * k)} not
        </div>
      </div>
    </div>
  );
}

function DayCurve({ energy, k, month, hour }: { energy: EnergyEstimate; k: number; month: number; hour: number }) {
  const W = 360, H = 130, L = 34, B = 18, T = 8;
  const pw = W - L - 4, ph = H - B - T;
  const prof = energy.profile[month - 1].map((v) => v * k);
  const maxAll = Math.max(...energy.profile.flat()) * k; // fixed scale across months for comparison
  const step = niceStep(maxAll / 2, true);
  const top = Math.max(step, Math.ceil(maxAll / step) * step);
  const h0 = energy.hours[0], h1 = energy.hours[energy.hours.length - 1];
  const x = (h: number) => L + ((h - h0) / (h1 - h0)) * pw;
  const y = (v: number) => T + ph - (ph * v) / top;
  const pts = prof.map((v, i) => `${x(energy.hours[i]).toFixed(1)},${y(v).toFixed(1)}`);
  const peak = prof.indexOf(Math.max(...prof));
  // value at the selected time (linear interpolation)
  const t = Math.min(h1, Math.max(h0, hour));
  const i = Math.min(prof.length - 2, Math.floor((t - h0) / 0.5));
  const now = prof[i] + ((prof[i + 1] - prof[i]) * (t - energy.hours[i])) / 0.5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`Estimated output through a typical day in ${MONTHS[month - 1]}`}>
      {[0, step, 2 * step].filter((v) => v <= top).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#9ca3af" : "#e5e7eb"} />
          <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#6b7280">{v.toFixed(v < 1 ? 1 : 0)} kW</text>
        </g>
      ))}
      {[6, 9, 12, 15, 18].map((hh) => (
        <text key={hh} x={x(hh)} y={H - 4} textAnchor="middle" fontSize={9} fill="#6b7280">{hh === 12 ? "12 PM" : hh < 12 ? `${hh} AM` : `${hh - 12} PM`}</text>
      ))}
      <path d={`M${x(h0)},${y(0)} L${pts.join(" L")} L${x(h1)},${y(0)} Z`} fill={CLEAN} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={CLEAN} strokeWidth={2} strokeLinejoin="round" />
      <line x1={x(t)} x2={x(t)} y1={T} y2={T + ph} stroke="#111827" strokeDasharray="3 3" />
      <circle cx={x(t)} cy={y(now)} r={4} fill={CLEAN} stroke="#fff" strokeWidth={2} />
      <text x={Math.min(W - 60, x(t) + 6)} y={Math.max(T + 10, y(now) - 6)} fontSize={10} fill="#111827" fontWeight={600}>{formatHour(t)}: {now.toFixed(1)} kW</text>
      {prof[peak] > 0 && Math.abs(energy.hours[peak] - t) > 1.5 && (
        <text x={x(energy.hours[peak])} y={y(prof[peak]) - 5} textAnchor="middle" fontSize={9} fill="#6b7280">peak {prof[peak].toFixed(1)}</text>
      )}
    </svg>
  );
}

function niceStep(raw: number, allowFraction = false) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const s = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  return allowFraction ? s : Math.max(1, s);
}
