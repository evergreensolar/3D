"use client";
// Monthly shading summary — single series (one hue, no legend), recessive grid, per-bar hover/tap
// tooltip, the selected month outlined, and a table view for exact values.
import { useState } from "react";
import type { ShadingSummary } from "@/lib/scene/shading";
import { MONTHS, formatHour } from "@/lib/time";

const BAR = "#3b5bdb";

export function ShadingChart({ summary, month, onMonth }: { summary: ShadingSummary; month?: number; onMonth?: (m: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(10, Math.ceil(Math.max(...summary.months.map((m) => m.shadedPct)) / 5) * 5);
  const W = 360, H = 170, L = 30, B = 20, T = 14;
  const plotW = W - L - 4, plotH = H - B - T;
  const slot = plotW / 12, bw = Math.min(18, slot * 0.6);
  const ticks = [0, max / 2, max];
  const shown = hover ?? (month ? month - 1 : null);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Panel area in shade, by month</h3>
        <span className="text-xs text-gray-500">9 AM – 4 PM</span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        Year average <b className="text-gray-900">{summary.annualPct}%</b>. Lower is better.
      </p>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Bar chart of percentage of panel area shaded for each month">
          {ticks.map((t) => {
            const y = T + plotH - (plotH * t) / max;
            return (
              <g key={t}>
                <line x1={L} x2={W - 4} y1={y} y2={y} stroke={t === 0 ? "#9ca3af" : "#e5e7eb"} strokeWidth={1} />
                <text x={L - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="#6b7280">{t % 1 ? t.toFixed(1) : t}%</text>
              </g>
            );
          })}
          {summary.months.map((m, i) => {
            const h = Math.max(0, (plotH * m.shadedPct) / max);
            const x = L + i * slot + (slot - bw) / 2;
            const y = T + plotH - h;
            const r = Math.min(4, h / 2, bw / 2);
            const selected = month === i + 1;
            return (
              <g key={i}>
                {h > 0.5 && (
                  <path
                    d={`M${x},${T + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + plotH} Z`}
                    fill={BAR}
                    opacity={shown === null || shown === i ? 1 : 0.55}
                  />
                )}
                {selected && <rect x={x - 3} y={T - 2} width={bw + 6} height={plotH + 4} rx={4} fill="none" stroke="#111827" strokeWidth={1} strokeDasharray="2 2" />}
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={selected ? "#111827" : "#6b7280"} fontWeight={selected ? 700 : 400}>
                  {MONTHS[i][0]}
                </text>
                {/* generous hit target */}
                <rect
                  x={L + i * slot} y={0} width={slot} height={H} fill="transparent" style={{ cursor: onMonth ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  onClick={() => onMonth?.(i + 1)}
                />
              </g>
            );
          })}
        </svg>
        {shown !== null && (
          <div
            className="pointer-events-none absolute -top-1 rounded-lg bg-gray-900 px-2 py-1 text-xs text-white shadow"
            style={{ left: `${((L + shown * slot + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
          >
            {MONTHS[shown]}: <b>{summary.months[shown].shadedPct}%</b> shaded
          </div>
        )}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gray-600">Show table by time of day</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-right tabular-nums">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left font-medium pr-2">Month</th>
                {summary.hours.filter(Number.isInteger).map((h) => <th key={h} className="font-medium px-1">{formatHour(h).replace(":00", "")}</th>)}
                <th className="font-semibold pl-1">Avg</th>
              </tr>
            </thead>
            <tbody>
              {summary.matrix.map((row, mi) => (
                <tr key={mi} className={mi % 2 ? "" : "bg-gray-50"}>
                  <td className="text-left pr-2">{MONTHS[mi]}</td>
                  {summary.hours.map((h, k) => (Number.isInteger(h) ? <td key={k} className="px-1">{row[k]}</td> : null))}
                  <td className="pl-1 font-semibold">{summary.months[mi].shadedPct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-gray-500">{summary.method}</p>
      </details>
    </div>
  );
}
