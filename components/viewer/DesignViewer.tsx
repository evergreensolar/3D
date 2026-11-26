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
import { NavPad } from "./NavPad";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentDTO } from "@/lib/comments";
import type { Measure, Vec3, ViewApi } from "./Scene3D";
import { instantOutputKw, type EnergyEstimate } from "@/lib/energy/model";
import { deserializePanels, type Panel, type PanelsFile } from "@/lib/scene/panels";

const Scene3D = dynamic(() => import("./Scene3D"), { ssr: false });

export interface DesignViewerProps {
  modelUrl: string;
  /** panels.json from processing (exact tagged/detected panels). */
  panelsUrl?: string | null;
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
  /** Saved dimension lines (shown to everyone). */
  annotations?: Measure[] | null;
  /** Team: allow saving measurements for the customer to see. */
  annotateVersionId?: string | null;
  /** Comments on this version (customer link or team page). */
  comments?: { endpoint: string; versionId?: string; team: boolean; locked: boolean } | null;
  /** Shown above the tabs (e.g. customer actions: meeting, approval). */
  topBar?: React.ReactNode;
  /** Shown over the 3D view (e.g. the video call). */
  overlay?: React.ReactNode;
}

type Tab = "sun" | "energy" | "comments" | "summary" | "details";
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
  const [api, setApi] = useState<ViewApi | null>(null);
  // Full screen: the browser's fullscreen where available (desktop / Android), CSS-only otherwise (iPhone).
  const viewRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const enterFull = () => {
    setFull(true);
    history.pushState({ evgFull: true }, ""); // phone "back" leaves full screen instead of the page
    viewRef.current?.requestFullscreen?.().catch(() => {});
  };
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    if (!full) return;
    const onPop = () => exitFull();
    const onFs = () => { if (!document.fullscreenElement) { setFull(false); if (history.state?.evgFull) history.back(); } };
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFs);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("fullscreenchange", onFs); };
  }, [full, exitFull]);
  const [dragMode, setDragModeState] = useState<"rotate" | "move">("rotate");
  const setDragMode = (m: "rotate" | "move") => { setDragModeState(m); api?.setDragMode(m); };
  const [measuring, setMeasuring] = useState(false);
  const [pending, setPending] = useState<Vec3 | null>(null);
  const [savedMeasures, setSavedMeasures] = useState<Measure[]>(() => (p.annotations ?? []).map((m) => ({ ...m, saved: true })));
  const [sessionMeasures, setSessionMeasures] = useState<Measure[]>([]);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);
  const onPick = useCallback((pt: Vec3) => {
    setPending((first) => {
      if (!first) return pt;
      setSessionMeasures((s) => [...s, { a: first, b: pt }]);
      return null;
    });
  }, []);
  // ---- comments
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [commentPicking, setCommentPicking] = useState(false);
  const [commentPoint, setCommentPoint] = useState<Vec3 | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const cfg = p.comments;
  const commentsUrl = cfg ? `${cfg.endpoint}${cfg.versionId ? `?versionId=${cfg.versionId}` : ""}` : null;
  useEffect(() => {
    if (!commentsUrl) return;
    fetch(commentsUrl).then((r) => r.json()).then((j) => setComments(j.comments ?? [])).catch(() => {});
  }, [commentsUrl]);
  const onCommentPick = useCallback((pt: Vec3) => { setCommentPoint(pt); setCommentPicking(false); setTab("comments"); }, []);
  async function postComment(body: string, opts: { pinned: boolean; parentId?: string }): Promise<string | null> {
    if (!cfg) return "Comments are not available";
    const r = await fetch(cfg.endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, versionId: cfg.versionId, parentId: opts.parentId ?? null, anchor: opts.pinned && commentPoint ? { point: commentPoint } : null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return j.error ?? "Could not send";
    setComments(j.comments ?? []);
    if (opts.pinned) setCommentPoint(null);
    return null;
  }
  async function resolveComment(id: string, resolved: boolean) {
    await fetch(`/api/team/comments/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved }) });
    if (commentsUrl) setComments((await (await fetch(commentsUrl)).json()).comments ?? []);
  }
  const pins = useMemo(() => [
    ...comments.filter((c) => c.anchor).map((c) => ({ id: c.id, n: c.n, point: c.anchor!.point, resolved: !!c.resolvedAt, active: c.id === activeComment })),
    ...(commentPoint ? [{ id: "new", n: comments.filter((c) => c.anchor).length + 1, point: commentPoint, resolved: false, active: true }] : []),
  ], [comments, commentPoint, activeComment]);
  const openComments = comments.filter((c) => !c.resolvedAt).length;

  async function saveMeasures() {
    if (!p.annotateVersionId) return;
    const items = [...savedMeasures, ...sessionMeasures].map(({ a, b, label }) => ({ a, b, label: label?.trim() || undefined }));
    const r = await fetch(`/api/team/versions/${p.annotateVersionId}/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
    if (r.ok) { setSavedMeasures(items.map((m) => ({ ...m, saved: true }))); setSessionMeasures([]); setMeasureMsg("Saved — the customer now sees these measurements."); }
    else setMeasureMsg("Could not save the measurements.");
  }
  const [normals, setNormals] = useState<[number, number, number][]>([]);
  const [weights, setWeights] = useState<number[]>([]);
  // undefined = still loading panels.json; null = none (detect from model)
  const [panels, setPanels] = useState<Panel[] | null | undefined>(p.panelsUrl ? undefined : null);
  useEffect(() => {
    if (!p.panelsUrl) { setPanels(null); return; }
    let live = true;
    fetch(p.panelsUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PanelsFile | null) => { if (live) setPanels(j?.panels?.length ? deserializePanels(j) : null); })
      .catch(() => { if (live) setPanels(null); });
    return () => { live = false; };
  }, [p.panelsUrl]);
  const [error, setError] = useState<string | null>(null);
  const compassRef = useRef<HTMLDivElement>(null);

  const light = useMemo(() => dayLight(SIM_YEAR, month, day, p.lat, p.lng), [month, day, p.lat, p.lng]);
  const date = useMemo(() => istDate(SIM_YEAR, month, day, hour), [month, day, hour]);
  const opts = useMemo(() => ({ lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg }), [p.lat, p.lng, p.northOffsetDeg]);
  const out = (sky: "clear" | "average", cleaned = true) =>
    sun && p.kwp && normals.length
      ? instantOutputKw({ lat: p.lat, lng: p.lng, northOffsetDeg: p.northOffsetDeg, date, month, normals, weights, fractions: sun.fractions, kwp: p.kwp, sky, cleaned })
      : null;
  const sunnyKw = out("clear"), sunnyDustyKw = out("clear", false), avgKw = out("average");
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
      <div ref={viewRef} className={full ? "fixed inset-0 z-50 bg-sky-200" : "relative min-h-[46vh] flex-1 bg-sky-200 lg:min-h-0"}>
        <ErrorCatcher onError={setError}>
          <Suspense fallback={null}>
            {panels !== undefined && <Scene3D
              url={p.modelUrl}
              opts={opts}
              panels={panels}
              date={date}
              highlight={highlight}
              onSun={setSun}
              onReady={(i) => { setPanelCount(i.panelCount); setNormals(i.normals); setWeights(i.weights); }}
              onHeading={onHeading}
              onApi={setApi}
              onPick={measuring ? onPick : commentPicking ? onCommentPick : null}
              pins={pins}
              onPinClick={(id) => { if (id === "new") return; setActiveComment(id); setTab("comments"); setTimeout(() => document.getElementById(`c-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}
              measures={[...savedMeasures, ...sessionMeasures]}
              pending={pending}
            />}
          </Suspense>
        </ErrorCatcher>
        <LoadingOverlay done={panelCount !== null} error={error} />

        {full ? (
          <button className="absolute left-3 top-3 z-40 rounded-xl bg-gray-900/85 px-3 py-2 text-sm font-semibold text-white shadow" onClick={() => (history.state?.evgFull ? history.back() : exitFull())}>
            ← Back
          </button>
        ) : (
          <button className="absolute bottom-3 right-3 z-30 hidden rounded-xl bg-white/90 px-3 py-2 text-xs font-semibold shadow-sm ring-1 ring-black/10 sm:block" onClick={enterFull} title="Full screen">⛶ Full screen</button>
        )}
        {/* time readout */}
        <div className={`pointer-events-none absolute z-30 left-3 ${full ? "top-16" : "top-3"} rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm ring-1 ring-black/5 backdrop-blur`}>
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

        {p.overlay}
        {commentPicking && (
          <div className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-xl bg-violet-700 px-3 py-2 text-xs text-white shadow">
            Tap the spot on the model your comment is about · <button className="underline" onClick={() => setCommentPicking(false)}>Cancel</button>
          </div>
        )}
        <NavPad api={api} dragMode={dragMode} setDragMode={setDragMode} measuring={measuring} full={full} onFull={() => (full ? (history.state?.evgFull ? history.back() : exitFull()) : enterFull())}
          setMeasuring={(on) => { setMeasuring(on); setPending(null); if (on) setTab("details"); }} />
        {measuring && (
          <div className="absolute left-3 top-[72px] max-w-[60%] rounded-xl bg-pink-600 px-3 py-2 text-xs text-white shadow">
            {pending ? "Tap the second point" : "Tap the first point on the model"}
            <div className="mt-1 flex gap-3 font-semibold">
              {sessionMeasures.length > 0 && <button className="underline" onClick={() => setSessionMeasures((s) => s.slice(0, -1))}>Undo</button>}
              <button className="underline" onClick={() => { setMeasuring(false); setPending(null); }}>Done</button>
            </div>
          </div>
        )}

        {/* shading status */}
        {sun?.sun.up && panelCount !== null && panelCount > 0 && (
          <div className={`pointer-events-none absolute z-30 ${full ? "bottom-20" : "bottom-3"} left-3 right-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm ring-1 ring-black/5 backdrop-blur sm:right-auto sm:max-w-[70%]`}>
            <span className="font-semibold text-gray-900">
              {sun.shadedPanels === 0 ? "No shade on any panel" : `${sun.shadedPanels} of ${panelCount} panels have shade`}
            </span>
            <span className="text-gray-600">{sun.areaShadedPct.toFixed(1)}% of panel area</span>
            {sunnyKw !== null && (
              <span className="basis-full text-gray-700">
                Output now: <b className="text-brand-700">sunny day ≈ {sunnyKw.toFixed(1)} kW</b> clean · {sunnyDustyKw!.toFixed(1)} kW dusty
                <span className="text-gray-500"> · average weather ≈ {avgKw!.toFixed(1)} kW</span>
              </span>
            )}
            {highlight && sun.shadedPanels > 0 && (
              <span className="flex items-center gap-2 text-gray-600">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />partly
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />mostly
              </span>
            )}
          </div>
        )}
      </div>

      {full && (
        <div className="fixed bottom-3 left-3 right-3 z-[60] flex items-center gap-3 rounded-xl bg-white/95 px-3 py-2 shadow ring-1 ring-black/10">
          <button className="btn-primary h-9 w-9 shrink-0 p-0" onClick={() => setPlaying((x) => !x)} aria-label={playing ? "Pause" : "Animate the day"}>{playing ? "❚❚" : "▶"}</button>
          <input aria-label="Time of day" type="range" min={5} max={19} step={1 / 12} value={hour} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} className="min-w-0 flex-1" />
          <span className="w-24 shrink-0 text-right text-xs font-semibold">{day} {MONTHS[month - 1]} {formatHour(hour)}</span>
        </div>
      )}
      {/* controls */}
      <div className="flex max-h-[54vh] flex-col border-t border-gray-200 lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
        {p.topBar}
        <div className="flex border-b border-gray-200 px-1" role="tablist">
          {([["sun", "Sun"], ["energy", "Generation"], ...(cfg ? [["comments", `Comments${openComments ? ` (${openComments})` : ""}`]] : []), ["summary", "Shading"], ["details", "Details"]] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex-1 px-1 py-3 text-xs sm:text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}
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
              <p className="text-xs text-gray-500">Use the buttons on the right to move (▲▼◀▶), rotate (⟲⟳) and zoom (+ −); ⌂ resets the view. “Rotate / Move” sets what a one-finger drag does. 📏 measures between two points. Sun position is calculated for the exact site location.</p>
            </div>
          )}

          {tab === "energy" && (
            p.energy ? <GenerationPanel energy={p.energy} kwp={p.kwp ?? null} month={month} hour={hour} onMonth={(m) => { setMonth(m); setDay(MONTH_DAY); }} />
              : <p className="text-sm text-gray-500">The generation estimate is not available for this version yet. Re-process it to calculate.</p>
          )}

          {tab === "comments" && cfg && (
            <CommentsPanel comments={comments} team={cfg.team} locked={cfg.locked} picking={commentPicking} pendingPoint={!!commentPoint}
              activeId={activeComment}
              onStartPin={() => { setMeasuring(false); setCommentPoint(null); setCommentPicking(true); }}
              onCancelPin={() => { setCommentPicking(false); setCommentPoint(null); }}
              onPost={postComment} onResolve={cfg.team ? resolveComment : undefined}
              onSelect={(id) => setActiveComment(id)} />
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
              {(savedMeasures.length > 0 || sessionMeasures.length > 0) && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Measurements</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {[...savedMeasures.map((m, i) => ({ m, i, saved: true })), ...sessionMeasures.map((m, i) => ({ m, i, saved: false }))].map(({ m, i, saved }) => {
                      const dist = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]);
                      const dh = Math.abs(m.b[1] - m.a[1]);
                      const setLabel = (label: string) => (saved ? setSavedMeasures : setSessionMeasures)((list) => list.map((x, k) => (k === i ? { ...x, label } : x)));
                      const remove = () => (saved ? setSavedMeasures : setSessionMeasures)((list) => list.filter((_, k) => k !== i));
                      return (
                        <li key={`${saved}-${i}`} className="flex items-center gap-2">
                          <i className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${saved ? "bg-amber-500" : "bg-pink-500"}`} />
                          {p.annotateVersionId ? (
                            <input className="input min-w-0 flex-1 px-2 py-1 text-xs" placeholder="Label, e.g. Structure height" value={m.label ?? ""} onChange={(e) => setLabel(e.target.value)} />
                          ) : <span className="min-w-0 flex-1 truncate text-xs text-gray-600">{m.label || (saved ? "Dimension" : "Your measurement")}</span>}
                          <span className="shrink-0 text-xs font-semibold tabular-nums">{dist.toFixed(2)} m{dh > 0.05 && Math.abs(dh - dist) > 0.05 ? ` · ↕${dh.toFixed(2)}` : ""}</span>
                          {(!saved || p.annotateVersionId) && <button className="text-xs text-red-600" onClick={remove} title="Remove">✕</button>}
                        </li>
                      );
                    })}
                  </ul>
                  {p.annotateVersionId && (
                    <button className="btn-secondary mt-2 w-full" onClick={saveMeasures}>Save measurements for the customer</button>
                  )}
                  {measureMsg && <p className="mt-1 text-xs text-gray-600">{measureMsg}</p>}
                </div>
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
