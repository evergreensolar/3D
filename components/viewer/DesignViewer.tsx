"use client";
import dynamic from "next/dynamic";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useProgress } from "@react-three/drei";
import type { SunResult } from "@/lib/scene/stage";
import type { ShadingSummary } from "@/lib/scene/shading";
import { DATE_PRESETS, MONTH_DAY, SIM_YEAR, compassPoint, dayLight } from "@/lib/scene/sun";
import { MONTHS, formatHour, istDate } from "@/lib/time";
import { ShadingChart } from "./ShadingChart";
import { GenerationPanel } from "./GenerationPanel";
import { instantOutputKw, type EnergyEstimate } from "@/lib/energy/model";

const Scene3D = dynamic(() => import("./Scene3D"), { ssr: false });

export interface DesignViewerProps {
  modelUrl: string;
  lat: number;
  lng: number;
  northOffsetDeg: number;
  summary: ShadingSummary | null;
  /** Per-kWp generation estimate from processing. */
  energy?: EnergyEstimate | null;
  /** System size; null until the panel rating is known. */
  kwp?: number | null;
  details: { label: string; value: string }[];
  reportUrl?: string;
  /** Extra panel content (e.g. team actions) shown in the "Details" tab. */
  extra?: React.ReactNode;
}

type Tab = "sun" | "energy" | "summary" | "details";
const PLAY_SECONDS = 14;

export function DesignViewer(p: DesignViewerProps) {
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [day, setDay] = useState(MONTH_DAY);
  const [hour, setHour] = useState(11);
  const [playing, setPlaying] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [tab, setTab] = useState<Tab>("sun");
  const [sun, setSun] = useState<SunResult | null>(null);
  const [panelCount, setPanelCount] = useState<number | null>(null);
  const [normals, setNormals] = useState<[number, number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const compassRef = useRef<HTMLDivElement>(null);

  const light = useMemo(() => dayLight(SIM_YEAR, month, day, p.lat, p.lng), [month, day, p.lat, p.lng]);
  const date = useMemo(() => istDate(SIM_YEAR, month, day, hour), [month, day, hour]);
  const opts = useMemo(() => ({ lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg }), [p.lat, p.lng, p.northOffsetDeg]);
  const outputKw = sun && p.kwp && normals.length
    ? instantOutputKw({ lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg, date, month, normals, fractions: sun.fractions, kwp: p.kwp })
    : null;
  const activePreset = DATE_PRESETS.find((d) => d.month === month && d.day === day)?.id;

  // "Animate the day": sunrise → sunset in PLAY_SECONDS.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const span = light.sunset - light.sunrise;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let stop = false;
      setHour((h) => {
        const start = h < light.sunrise || h >= light.sunset - 0.01 ? light.sunrise : h;
        const next = start + (span * dt) / PLAY_SECONDS;
        if (next >= light.sunset) { stop = true; return light.sunset; }
        return next;
      });
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, light.sunrise, light.sunset]);

  const onHeading = useCallback((deg: number) => {
    if (compassRef.current) compassRef.current.style.transform = `rotate(${-deg}deg)`;
  }, []);

  const pickPreset = (m: number, d: number) => { setMonth(m); setDay(d); };

  return (
    <div className="flex h-full w-full flex-col lg:flex-row bg-white">
      {/* 3D canvas */}
      <div className="relative min-h-[46vh] flex-1 bg-sky-200 lg:min-h-0">
        <ErrorCatcher onError={setError}>
          <Suspense fallback={null}>
            <Scene3D
              url={p.modelUrl}
              opts={opts}
              date={date}
              highlight={highlight}
              onSun={setSun}
              onReady={(i) => { setPanelCount(i.panelCount); setNormals(i.normals); }}
              onHeading={onHeading}
            />
          </Suspense>
        </ErrorCatcher>
        <LoadingOverlay done={panelCount !== null} error={error} />

        {/* time readout */}
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm ring-1 ring-black/5 backdrop-blur">
          <div className="font-semibold text-gray-900">{day} {MONTHS[month - 1]} · {formatHour(hour)} IST</div>
          {sun && (sun.sun.up ? (
            <div className="text-gray-600">Sun {Math.round(sun.sun.altitudeDeg)}° high, from {compassPoint(sun.sun.azimuthDeg)}</div>
          ) : <div className="text-gray-600">Sun is below the horizon</div>)}
        </div>

        {/* compass HUD */}
        <div className="pointer-events-none absolute right-3 top-3 h-12 w-12 rounded-full bg-white/90 shadow-sm ring-1 ring-black/5" title="North">
          <div ref={compassRef} className="h-full w-full transition-transform duration-75">
            <svg viewBox="0 0 48 48" className="h-full w-full">
              <path d="M24 6 L29 24 L19 24 Z" fill="#dc2626" />
              <path d="M24 42 L29 24 L19 24 Z" fill="#9ca3af" />
              <text x="24" y="17" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">N</text>
            </svg>
          </div>
        </div>

        {/* shading status */}
        {sun?.sun.up && panelCount !== null && panelCount > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm ring-1 ring-black/5 backdrop-blur sm:right-auto">
            <span className="font-semibold text-gray-900">
              {sun.shadedPanels === 0 ? "No shade on any panel" : `${sun.shadedPanels} of ${panelCount} panels have shade`}
            </span>
            <span className="text-gray-600">{sun.areaShadedPct.toFixed(1)}% of panel area</span>
            {outputKw !== null && <span className="font-semibold text-brand-700">Average output now ≈ {outputKw.toFixed(1)} kW</span>}
            {highlight && sun.shadedPanels > 0 && (
              <span className="flex items-center gap-2 text-gray-600">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />partly
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />mostly
              </span>
            )}
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex max-h-[54vh] flex-col border-t border-gray-200 lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="flex border-b border-gray-200 px-2" role="tablist">
          {([["sun", "Sun"], ["energy", "Generation"], ["summary", "Shading"], ["details", "Details"]] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex-1 px-2 py-3 text-sm font-semibold border-b-2 -mb-px ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {tab === "sun" && (
            <div className="space-y-4">
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {DATE_PRESETS.map((d) => (
                  <button
                    key={d.id} onClick={() => pickPreset(d.month, d.day)}
                    className={`chip ${activePreset === d.id ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`}
                  >
                    {d.label} <span className="ml-1 opacity-75">{d.short}</span>
                  </button>
                ))}
              </div>

              <div>
                <div className="flex justify-between text-sm">
                  <label htmlFor="month" className="font-medium text-gray-700">Month</label>
                  <span className="font-semibold">{day} {MONTHS[month - 1]}</span>
                </div>
                <input id="month" type="range" min={1} max={12} step={1} value={month}
                  onChange={(e) => { setMonth(Number(e.target.value)); setDay(MONTH_DAY); }} />
                <div className="flex justify-between text-[10px] text-gray-400">{MONTHS.map((m) => <span key={m}>{m[0]}</span>)}</div>
              </div>

              <div>
                <div className="flex justify-between text-sm">
                  <label htmlFor="hour" className="font-medium text-gray-700">Time of day</label>
                  <span className="font-semibold">{formatHour(hour)}</span>
                </div>
                <input id="hour" type="range" min={5} max={19} step={1 / 12} value={hour}
                  onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} />
                <div className="flex justify-between text-[11px] text-gray-500">
                  <span>☀ rise {formatHour(light.sunrise)}</span>
                  <span>set {formatHour(light.sunset)}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button className="btn-primary flex-1" onClick={() => setPlaying((x) => !x)}>
                  {playing ? (
                    <><svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><rect x="4" y="3" width="4" height="14" rx="1" /><rect x="12" y="3" width="4" height="14" rx="1" /></svg>Pause</>
                  ) : (
                    <><svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M5 3l12 7-12 7z" /></svg>Animate the day</>
                  )}
                </button>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
                  Highlight shade
                </label>
              </div>
              {panelCount === 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">No solar panels were recognised in this model, so shading cannot be highlighted.</p>
              )}
              <p className="text-xs text-gray-500">Drag to rotate, pinch to zoom, two fingers to move. Sun position is calculated for the exact site location.</p>
            </div>
          )}

          {tab === "energy" && (
            p.energy ? <GenerationPanel energy={p.energy} kwp={p.kwp ?? null} month={month} hour={hour} onMonth={(m) => { setMonth(m); setDay(MONTH_DAY); }} />
              : <p className="text-sm text-gray-500">The generation estimate is not available for this version yet. Re-process it to calculate.</p>
          )}

          {tab === "summary" && (
            p.summary ? <ShadingChart summary={p.summary} month={month} onMonth={(m) => { setMonth(m); setDay(MONTH_DAY); setTab("sun"); }} />
              : <p className="text-sm text-gray-500">The yearly summary is not available yet.</p>
          )}

          {tab === "details" && (
            <div className="space-y-4">
              <dl className="divide-y divide-gray-100 text-sm">
                {p.details.map((d) => (
                  <div key={d.label} className="flex justify-between gap-4 py-2">
                    <dt className="text-gray-500">{d.label}</dt>
                    <dd className="text-right font-medium text-gray-900">{d.value}</dd>
                  </div>
                ))}
              </dl>
              {p.reportUrl && (
                <a className="btn-secondary w-full" href={p.reportUrl}>
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M10 3v9m0 0l-4-4m4 4l4-4M4 15h12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
                  Download PDF report
                </a>
              )}
              {p.extra}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingOverlay({ done, error }: { done: boolean; error: string | null }) {
  const { progress } = useProgress();
  if (done && !error) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-sky-100/80">
      <div className="w-56 text-center">
        {error ? (
          <p className="text-sm text-red-700">Could not load the 3D model. Please check your connection and reload.<br /><span className="text-xs text-red-500">{error}</span></p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">Loading 3D design…</p>
            <div className="mt-2 h-2 rounded-full bg-white">
              <div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(5, progress)}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

class ErrorCatcher extends Component<{ onError: (m: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e.message); }
  render() { return this.state.failed ? null : this.props.children; }
}
