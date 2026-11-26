"use client";
// Design Studio: survey-accurate roof (rectangle, walk-the-edges, trace on satellite, side lengths in
// ft-in or m, flat or sloped roof), obstructions, structures (adjustable rows × columns, or ready-made
// structures from the admin library — drag & drop, move, rotate, duplicate, ± panels), inverter,
// live 3D, then save as a design version processed like an uploaded SketchUp model.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { newDesign, newParamBlock, OBSTACLE_PRESETS, roofHeight, uid, type Block, type Design, type Obstacle, type ObstacleKind, type ParamBlock, type Pt, type TemplateMeta } from "@/lib/design/types";
import { autoFillBlocks, blockIssues, blockStats, designStats, migrateDesign, polygonArea } from "@/lib/design/layout";
import { buildDesignScene, type LibraryModels } from "@/lib/design/build3d";
import { bearingOf, closingGap, edgesOf, isRectangle, rectangle, setSideLength, walk } from "@/lib/design/outline";
import { bearingLong, bearingName, fmtLen, parseLen } from "@/lib/design/units";
import { loadModel } from "@/lib/scene/load";
import { prepareModel } from "@/lib/scene/stage";
import { PlanView, type Selection, type Tool } from "./PlanView";

type Tab = "roof" | "structures" | "obstacles" | "inverter";
const DIRS = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SW", 225], ["W", 270], ["NW", 315]] as const;

// library models are loaded once per page
const libCache = new Map<string, Promise<THREE.Object3D>>();
function loadTemplate(t: TemplateMeta) {
  if (!libCache.has(t.id)) libCache.set(t.id, loadModel(t.modelUrl!, "GLB").then((o) => { prepareModel(o); return o; }));
  return libCache.get(t.id)!;
}
async function libraryFor(d: Design, metas: Record<string, TemplateMeta>): Promise<LibraryModels> {
  const ids = [...new Set(d.blocks.filter((b) => b.kind === "library").map((b) => (b as { templateId: string }).templateId))].filter((id) => metas[id]);
  const out: LibraryModels = {};
  await Promise.all(ids.map(async (id) => { out[id] = { meta: metas[id], object: await loadTemplate(metas[id]) }; }));
  return out;
}

export function DesignStudio(p: {
  projectId: string; projectCode: string; customerName: string; lat: number; lng: number; defaultWp: number;
  initial: unknown | null; templates: TemplateMeta[]; tileUrl: string; attribution: string; isAdmin: boolean;
}) {
  const router = useRouter();
  const [d, setD] = useState<Design>(() => (p.initial ? migrateDesign(p.initial) : newDesign(p.lat, p.lng, p.defaultWp)));
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<Tab>(() => ((p.initial as Design | null)?.building?.outline?.length ? "structures" : "roof"));
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [sel, setSel] = useState<Selection>(null);
  const [snap, setSnap] = useState(true);
  const [satellite, setSatellite] = useState(1);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const metas = useMemo(() => Object.fromEntries(p.templates.map((t) => [t.id, t])), [p.templates]);

  const update = (fn: (x: Design) => Design) => setD((cur) => fn(structuredClone(cur)));
  const stats = designStats(d, metas);
  const warnings = d.blocks.filter((b) => blockIssues(d, b, metas).length).length;
  const selBlock = sel?.kind === "block" ? d.blocks.find((b) => b.id === sel.id) ?? null : null;
  const selObstacle = sel?.kind === "obstacle" ? d.obstacles.find((o) => o.id === sel.id) ?? null : null;
  const setBlock = (id: string, patch: Partial<ParamBlock> & Record<string, unknown>) => update((x) => { x.blocks = x.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)); return x; });
  const setObstacle = (id: string, patch: Partial<Obstacle>) => update((x) => { x.obstacles = x.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)); return x; });
  const area = polygonArea(d.building.outline);

  function place(what: string, at: Pt) {
    const id = uid();
    update((x) => {
      if (what === "param") x.blocks.push({ ...newParamBlock(x.array, at[0], at[1]), id });
      else if (metas[what]) x.blocks.push({ id, kind: "library", templateId: what, x: at[0], z: at[1], rot: 0, repeat: 1 });
      return x;
    });
    setSel({ kind: "block", id });
    setTab("structures");
  }

  // keyboard: delete / nudge the selected item
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).closest("input,textarea,select")) return;
      const step = e.shiftKey ? 0.5 : 0.1;
      const mv: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key === "Delete" || e.key === "Backspace") {
        update((x) => { x.blocks = x.blocks.filter((b) => b.id !== sel.id); x.obstacles = x.obstacles.filter((o) => o.id !== sel.id); return x; });
        setSel(null);
      } else if (mv[e.key]) {
        e.preventDefault();
        const [dx, dz] = mv[e.key];
        update((x) => {
          x.blocks = x.blocks.map((b) => (b.id === sel.id ? { ...b, x: b.x + dx, z: b.z + dz } : b));
          x.obstacles = x.obstacles.map((o) => (o.id === sel.id ? { ...o, x: o.x + dx, z: o.z + dz } : o));
          return x;
        });
      } else if (e.key === "Escape") { setSel(null); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save() {
    if (!stats.panels) { setError("Place at least one structure with panels first."); return; }
    setError(null);
    try {
      setSaving("Building the 3D model…");
      const scene = buildDesignScene(d, await libraryFor(d, metas));
      const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
      setSaving("Uploading…");
      const start = await fetch("/api/team/uploads", { method: "POST" }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? "Could not start upload");
      const blob = new Blob([glb], { type: "model/gltf-binary" });
      const n = Math.ceil(blob.size / start.chunkBytes);
      for (let i = 0; i < n; i++) {
        const r = await fetch(`/api/team/uploads/${start.id}?index=${i}`, { method: "PUT", body: blob.slice(i * start.chunkBytes, (i + 1) * start.chunkBytes) });
        if (!r.ok) throw new Error("Upload failed — please try again");
      }
      setSaving("Saving the design…");
      const r = await fetch(`/api/team/projects/${p.projectId}/versions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: start.id, chunks: n, filename: "studio-design.glb", design: d }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Save failed (${r.status})`);
      router.push(`/team/projects/${p.projectId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  }

  const toolHint: Partial<Record<string, string>> = {
    outline: "Click each roof corner in order (Snap 90° keeps sides N/S/E/W). Click the first corner to close.",
    measure: "Click two points to measure. Click again to start a new measurement.",
  };
  const hint = tool.startsWith("place:") ? "Click on the roof to place it (or drag from the list)." : toolHint[tool];

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col lg:flex-row">
      <div className="relative min-h-[55vh] flex-1 overflow-hidden bg-gray-200">
        {view === "2d"
          ? <PlanView d={d} metas={metas} tool={tool} setTool={setTool} sel={sel} setSel={setSel} update={update} tileUrl={p.tileUrl} snap={snap} satellite={satellite} onPlace={place} />
          : <Preview3D d={d} metas={metas} />}
        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-black/5">
          {(["2d", "3d"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${view === v ? "bg-brand-600 text-white" : "text-gray-700"}`}>{v === "2d" ? "Plan" : "3D view"}</button>
          ))}
          {view === "2d" && (
            <>
              <span className="mx-1 w-px bg-gray-200" />
              <button onClick={() => setTool(tool === "measure" ? "select" : "measure")} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tool === "measure" ? "bg-pink-600 text-white" : "text-gray-700"}`}>📏 Measure</button>
              <label className="flex items-center gap-1 px-2 text-xs text-gray-700">Map
                <input type="range" min={0} max={1} step={0.1} value={satellite} onChange={(e) => setSatellite(Number(e.target.value))} className="h-4 w-16" />
              </label>
            </>
          )}
        </div>
        {view === "2d" && hint && (
          <div className="absolute left-1/2 top-14 z-10 max-w-[90%] -translate-x-1/2 rounded-xl bg-gray-900/90 px-3 py-2 text-xs text-white shadow">
            {hint} <button className="ml-2 font-semibold underline" onClick={() => setTool("select")}>Done</button>
          </div>
        )}
        {view === "2d" && <div className="pointer-events-none absolute bottom-1 right-14 text-[10px] text-white/90 drop-shadow">{p.attribution}</div>}
      </div>

      <aside className="flex max-h-[45vh] w-full flex-col border-t border-gray-200 bg-white lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="border-b border-gray-100 p-3">
          <div className="text-xs text-gray-500"><Link href={`/team/projects/${p.projectId}`} className="hover:underline">{p.projectCode}</Link> · {p.customerName}</div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
            <Stat label="Panels" value={String(stats.panels)} />
            <Stat label="System" value={`${stats.kwp.toFixed(2)} kWp`} />
            <Stat label="Roof" value={d.units === "ft" ? `${Math.round(area * 10.7639)} ft²` : `${area.toFixed(0)} m²`} />
            <Stat label="Warnings" value={String(warnings)} bad={warnings > 0} />
          </div>
        </div>
        <div className="flex border-b border-gray-200 px-1 text-xs sm:text-sm">
          {([["roof", "Roof"], ["structures", "Structures"], ["obstacles", "Obstructions"], ["inverter", "Inverter"]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px flex-1 border-b-2 px-1 py-2.5 font-semibold ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {tab === "roof" && <RoofTab d={d} update={update} tool={tool} setTool={(t) => { setTool(t); setView("2d"); }} snap={snap} setSnap={setSnap} />}
          {tab === "structures" && (
            <StructuresTab d={d} metas={metas} templates={p.templates} update={update} selBlock={selBlock} setSel={setSel} setBlock={setBlock}
              tool={tool} setTool={(t) => { setTool(t); setView("2d"); }} isAdmin={p.isAdmin} />
          )}
          {tab === "obstacles" && <ObstaclesTab d={d} update={update} sel={selObstacle} setSel={setSel} setObstacle={setObstacle} tool={tool} setTool={(t) => { setTool(t); setView("2d"); }} />}
          {tab === "inverter" && <InverterTab d={d} update={update} kwp={stats.kwp} />}
        </div>
        <div className="border-t border-gray-100 p-3">
          {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          {warnings > 0 && <p className="mb-2 text-xs text-red-700">⚠ {warnings} structure(s) outside the roof or on an obstruction.</p>}
          <button className="btn-primary w-full py-3" disabled={!!saving} onClick={save}>{saving ?? `Save design (${stats.panels} panels, ${stats.kwp.toFixed(2)} kWp)`}</button>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- small inputs

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return <div className={`rounded-lg px-1 py-1.5 ${bad ? "bg-red-50 text-red-700" : "bg-brand-50"}`}><div className="text-[10px] text-gray-500">{label}</div><div className="text-xs font-semibold tabular-nums sm:text-sm">{value}</div></div>;
}

function Num({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-600">{label}</span>
      <input className="input px-2 py-1.5 text-sm" inputMode="decimal" type="number" step={step} min={min} max={max} value={text}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }} />
    </label>
  );
}

/** Length input in the design's units (accepts 40' 6", 40 6, 12.3m). */
function Len({ label, value, units, onChange }: { label?: string; value: number; units: "ft" | "m"; onChange: (m: number) => void }) {
  const [text, setText] = useState(fmtLen(value, units));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(fmtLen(value, units)); setBad(false); }, [value, units]);
  const commit = () => { const m = parseLen(text, units); if (m && m > 0) onChange(m); else setBad(true); };
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[11px] font-medium text-gray-600">{label}</span>}
      <input className={`input px-2 py-1.5 text-sm ${bad ? "ring-red-400" : ""}`} value={text} placeholder={units === "ft" ? `40' 6"` : "12.3"}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-gray-600">{label}</span>
      <div className="flex items-center gap-1">
        <button className="btn-secondary h-8 w-8 p-0" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
        <button className="btn-secondary h-8 w-8 p-0" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Roof

function RoofTab({ d, update, tool, setTool, snap, setSnap }: {
  d: Design; update: (fn: (x: Design) => Design) => void; tool: Tool; setTool: (t: Tool) => void; snap: boolean; setSnap: (v: boolean) => void;
}) {
  const u = d.units;
  const [rw, setRw] = useState(12.19), [rd, setRd] = useState(9.14); // 40' × 30'
  const [steps, setSteps] = useState<{ bearing: number; length: number }[]>([{ bearing: 90, length: 12.19 }, { bearing: 180, length: 9.14 }, { bearing: 270, length: 12.19 }]);
  const edges = edgesOf(d.building.outline);
  const walked = walk([0, 0], steps);
  const gap = closingGap(walked);
  const centre = (pts: Pt[]): Pt[] => {
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cz = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    return pts.map(([x, z]) => [Math.round((x - cx) * 1000) / 1000, Math.round((z - cz) * 1000) / 1000]);
  };
  const setOutline = (pts: Pt[]) => update((x) => { x.building.outline = pts; return x; });
  const shift = (dx: number, dz: number) => update((x) => { x.building.outline = x.building.outline.map(([a, b]) => [a + dx, b + dz]); return x; });
  const rotate = (deg: number) => update((x) => {
    const o = x.building.outline;
    const cx = o.reduce((s, q) => s + q[0], 0) / o.length, cz = o.reduce((s, q) => s + q[1], 0) / o.length;
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    x.building.outline = o.map(([a, b]) => [cx + (a - cx) * c - (b - cz) * s, cz + (a - cx) * s + (b - cz) * c]);
    return x;
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">Units</span>
        <div className="flex gap-1">
          {(["ft", "m"] as const).map((x) => (
            <button key={x} onClick={() => update((q) => { q.units = x; return q; })} className={`chip ${u === x ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`}>{x === "ft" ? "Feet & inches" : "Metres"}</button>
          ))}
        </div>
      </div>

      <details className="rounded-xl p-3 ring-1 ring-gray-200" open={!d.building.outline.length}>
        <summary className="cursor-pointer font-semibold">▭ Rectangle roof</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Len label="East–west length" value={rw} units={u} onChange={setRw} />
          <Len label="North–south length" value={rd} units={u} onChange={setRd} />
        </div>
        <button className="btn-secondary mt-2 w-full" onClick={() => setOutline(rectangle(rw, rd))}>Draw rectangle</button>
      </details>

      <details className="rounded-xl p-3 ring-1 ring-gray-200">
        <summary className="cursor-pointer font-semibold">↳ Site survey: walk the edges</summary>
        <p className="mt-1 text-xs text-gray-500">Start at any corner and enter each side in order: direction and length. The last side closes the roof automatically.</p>
        <ol className="mt-2 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[20px_88px_1fr_24px] items-center gap-1.5">
              <span className="text-xs text-gray-400">{i + 1}.</span>
              <select className="input px-1.5 py-1.5 text-sm" value={DIRS.find(([, b]) => b === s.bearing) ? s.bearing : -1}
                onChange={(e) => setSteps(steps.map((x, k) => (k === i ? { ...x, bearing: Number(e.target.value) } : x)))}>
                {DIRS.map(([n, b]) => <option key={n} value={b}>{bearingLong(b)}</option>)}
              </select>
              <Len value={s.length} units={u} onChange={(m) => setSteps(steps.map((x, k) => (k === i ? { ...x, length: m } : x)))} />
              <button className="text-red-500" onClick={() => setSteps(steps.filter((_, k) => k !== i))} title="Remove">✕</button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex items-center justify-between text-xs">
          <button className="font-semibold text-brand-700" onClick={() => setSteps([...steps, { bearing: ((steps[steps.length - 1]?.bearing ?? 0) + 90) % 360, length: 3 }])}>+ Add side</button>
          <span className="text-gray-500">Closing side: {gap > 0.005 ? `${bearingLong(bearingOf(walked[0][0] - walked[walked.length - 1][0], walked[0][1] - walked[walked.length - 1][1]))} ${fmtLen(gap, u)}` : "closed ✓"}</span>
        </div>
        <button className="btn-secondary mt-2 w-full" disabled={steps.length < 2} onClick={() => setOutline(centre(walked))}>Draw from survey</button>
      </details>

      <details className="rounded-xl p-3 ring-1 ring-gray-200">
        <summary className="cursor-pointer font-semibold">✎ Trace on the satellite map</summary>
        <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap sides to N/S/E/W</label>
        <button className="btn-secondary mt-2 w-full" onClick={() => { update((x) => { x.building.outline = []; return x; }); setTool("outline"); }}>{tool === "outline" ? "Tracing… (click corners)" : "Start tracing"}</button>
      </details>

      {edges.length >= 3 && (
        <div className="rounded-xl p-3 ring-1 ring-brand-200">
          <div className="font-semibold">Sides of the roof</div>
          <p className="text-xs text-gray-500">{isRectangle(d.building.outline) ? "Rectangle: changing a side also changes the opposite side." : "Change a length to match your survey; the following corners move with it."}</p>
          <ul className="mt-2 space-y-1.5">
            {edges.map((e) => (
              <li key={e.i} className="grid grid-cols-[1fr_110px] items-center gap-2">
                <span className="text-xs"><b>{bearingLong(e.side)}</b> side <span className="text-gray-400">({bearingName(e.bearing)}-running)</span></span>
                {e.i < edges.length - 1 || isRectangle(d.building.outline)
                  ? <Len value={e.length} units={u} onChange={(m) => update((x) => { x.building.outline = setSideLength(x.building.outline, e.i, m); return x; })} />
                  : <span className="text-right text-xs font-semibold">{fmtLen(e.length, u)} <span className="font-normal text-gray-400">(closing)</span></span>}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <div className="text-[11px] font-medium text-gray-600">Line up with the satellite photo</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {([["←", -0.25, 0], ["→", 0.25, 0], ["↑", 0, -0.25], ["↓", 0, 0.25]] as const).map(([l, dx, dz]) => <button key={l} className="btn-secondary h-8 w-8 p-0" onClick={() => shift(dx, dz)}>{l}</button>)}
              <button className="btn-secondary h-8 px-2 text-xs" onClick={() => rotate(-1)}>⟲ 1°</button>
              <button className="btn-secondary h-8 px-2 text-xs" onClick={() => rotate(1)}>⟳ 1°</button>
              <button className="btn-secondary h-8 px-2 text-xs" onClick={() => rotate(-5)}>⟲ 5°</button>
              <button className="btn-secondary h-8 px-2 text-xs" onClick={() => rotate(5)}>⟳ 5°</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Num label="Floors" value={d.building.floors} step={1} min={1} max={30} onChange={(v) => update((x) => { x.building.floors = v; return x; })} />
        <Len label="Floor height" value={d.building.floorHeight} units={u} onChange={(m) => update((x) => { x.building.floorHeight = m; return x; })} />
        <Len label="Parapet height" value={Math.max(0.01, d.building.parapet)} units={u} onChange={(m) => update((x) => { x.building.parapet = m; return x; })} />
      </div>
      <p className="text-xs text-gray-500">Roof level {fmtLen(roofHeight(d), u)} above ground.</p>

      <div className="rounded-xl p-3 ring-1 ring-gray-200">
        <div className="font-semibold">Roof type</div>
        <div className="mt-2 flex gap-1">
          <button className={`chip ${d.building.roof.type === "flat" ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`} onClick={() => update((x) => { x.building.roof = { type: "flat" }; return x; })}>Flat (RCC)</button>
          <button className={`chip ${d.building.roof.type === "mono" ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`} onClick={() => update((x) => { x.building.roof = { type: "mono", slopeDeg: 10, downBearing: 180 }; return x; })}>Sloped (tin shed)</button>
        </div>
        {d.building.roof.type === "mono" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="Slope (°)" value={d.building.roof.slopeDeg} step={1} min={1} max={45} onChange={(v) => update((x) => { if (x.building.roof.type === "mono") x.building.roof.slopeDeg = v; return x; })} />
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Slopes down towards</span>
              <select className="input px-2 py-1.5 text-sm" value={d.building.roof.downBearing} onChange={(e) => update((x) => { if (x.building.roof.type === "mono") x.building.roof.downBearing = Number(e.target.value); return x; })}>
                {DIRS.map(([n, b]) => <option key={n} value={b}>{bearingLong(b)}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Structures

function StructuresTab({ d, metas, templates, update, selBlock, setSel, setBlock, tool, setTool, isAdmin }: {
  d: Design; metas: Record<string, TemplateMeta>; templates: TemplateMeta[]; update: (fn: (x: Design) => Design) => void;
  selBlock: Block | null; setSel: (s: Selection) => void; setBlock: (id: string, patch: Record<string, unknown>) => void;
  tool: Tool; setTool: (t: Tool) => void; isAdmin: boolean;
}) {
  const u = d.units;
  const a = d.array;
  const dragProps = (what: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/evg-block", what); e.dataTransfer.effectAllowed = "copy"; },
    onClick: () => setTool(`place:block:${what}`),
  });
  const setA = <K extends keyof Design["array"]>(k: K, v: Design["array"][K]) => update((x) => { x.array[k] = v; return x; });
  const dup = (b: Block) => { const id = uid(); update((x) => { x.blocks.push({ ...structuredClone(b), id, x: b.x + 1, z: b.z + 1 }); return x; }); setSel({ kind: "block", id }); };
  const del = (b: Block) => { update((x) => { x.blocks = x.blocks.filter((q) => q.id !== b.id); return x; }); setSel(null); };

  return (
    <>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Add a structure</span>
          {isAdmin && <Link href="/team/library" className="text-xs font-semibold text-brand-700">Manage library →</Link>}
        </div>
        <p className="mb-2 text-xs text-gray-500">Drag onto the roof, or click then click the roof.</p>
        <div className="grid grid-cols-2 gap-2">
          <div {...dragProps("param")} className={`cursor-grab rounded-xl p-2 text-xs ring-1 ${tool === "place:block:param" ? "ring-2 ring-brand-500" : "ring-gray-200"} hover:bg-gray-50`}>
            <div className="flex h-16 items-center justify-center rounded-lg bg-blue-50 text-2xl">▦</div>
            <div className="mt-1 font-semibold">Adjustable structure</div>
            <div className="text-gray-500">rows × columns, any Wp</div>
          </div>
          {templates.map((t) => (
            <div key={t.id} {...dragProps(t.id)} className={`cursor-grab rounded-xl p-2 text-xs ring-1 ${tool === `place:block:${t.id}` ? "ring-2 ring-brand-500" : "ring-gray-200"} hover:bg-gray-50`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.thumbUrl ? <img src={t.thumbUrl} alt="" draggable={false} className="h-16 w-full rounded-lg object-cover" /> : <div className="h-16 rounded-lg bg-gray-100" />}
              <div className="mt-1 font-semibold leading-tight">{t.name}</div>
              <div className="text-gray-500">{t.panelCount} × {t.wp} Wp = {((t.panelCount * t.wp) / 1000).toFixed(2)} kWp</div>
            </div>
          ))}
        </div>
        {templates.length === 0 && <p className="mt-2 text-xs text-gray-500">No ready-made structures yet{isAdmin ? " — add them in the library." : "."}</p>}
      </div>

      {selBlock && (
        <div className="space-y-3 rounded-xl p-3 ring-2 ring-orange-300">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{selBlock.kind === "param" ? `Structure ${selBlock.rows} × ${selBlock.cols}` : metas[selBlock.templateId]?.name ?? "Structure"}</span>
            <span className="text-xs text-gray-600">{blockStats(selBlock, metas).panels} panels · {blockStats(selBlock, metas).kwp.toFixed(2)} kWp</span>
          </div>
          {blockIssues(d, selBlock, metas).map((w) => <p key={w} className="rounded-lg bg-red-50 p-1.5 text-xs text-red-700">⚠ {w}</p>)}
          {selBlock.kind === "param" ? (
            <>
              <div className="flex gap-4">
                <Stepper label="Rows" value={selBlock.rows} min={1} max={12} onChange={(v) => setBlock(selBlock.id, { rows: v })} />
                <Stepper label="Panels per row" value={selBlock.cols} min={1} max={40} onChange={(v) => setBlock(selBlock.id, { cols: v })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Panel Wp" value={selBlock.wp} step={5} min={100} max={1000} onChange={(v) => setBlock(selBlock.id, { wp: v })} />
                <Num label="Tilt (°)" value={selBlock.tilt} step={1} min={0} max={45} onChange={(v) => setBlock(selBlock.id, { tilt: v })} />
                <Len label="Structure height" value={Math.max(0.01, selBlock.height)} units={u} onChange={(m) => setBlock(selBlock.id, { height: m })} />
                <Len label="Panel length" value={selBlock.panelL} units={u} onChange={(m) => setBlock(selBlock.id, { panelL: m })} />
                <Len label="Panel width" value={selBlock.panelW} units={u} onChange={(m) => setBlock(selBlock.id, { panelW: m })} />
                <Len label="Gap between rows" value={Math.max(0.01, selBlock.rowGap)} units={u} onChange={(m) => setBlock(selBlock.id, { rowGap: m })} />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Panels face: {bearingLong(selBlock.facing)} ({Math.round(selBlock.facing)}°)</span>
                <div className="flex flex-wrap gap-1">
                  {([["S", 180], ["E", 90], ["W", 270], ["N", 0]] as const).map(([n, b]) => <button key={n} className="btn-secondary h-8 px-2.5 text-xs" onClick={() => setBlock(selBlock.id, { facing: b })}>{n}</button>)}
                  <button className="btn-secondary h-8 px-2 text-xs" onClick={() => setBlock(selBlock.id, { facing: (selBlock.facing + 355) % 360 })}>⟲ 5°</button>
                  <button className="btn-secondary h-8 px-2 text-xs" onClick={() => setBlock(selBlock.id, { facing: (selBlock.facing + 5) % 360 })}>⟳ 5°</button>
                  <button className="btn-secondary h-8 px-2 text-xs" onClick={() => setBlock(selBlock.id, { orientation: selBlock.orientation === "portrait" ? "landscape" : "portrait" })}>{selBlock.orientation === "portrait" ? "Portrait" : "Landscape"} ⇄</button>
                </div>
              </div>
              {d.building.roof.type === "mono" && (
                <button className="btn-secondary w-full text-xs" onClick={() => d.building.roof.type === "mono" && setBlock(selBlock.id, { tilt: d.building.roof.slopeDeg, facing: d.building.roof.downBearing, height: 0.12, rowGap: 0.02 })}>Flush on the sloped roof</button>
              )}
              <p className="text-xs text-gray-500">Click a panel (when the structure is selected) to remove it; click again to put it back.</p>
              {selBlock.removed.length > 0 && <button className="text-xs font-semibold text-brand-700" onClick={() => setBlock(selBlock.id, { removed: [] })}>Restore {selBlock.removed.length} removed panel(s)</button>}
            </>
          ) : (
            <>
              <Stepper label="Copies side by side" value={selBlock.repeat} min={1} max={20} onChange={(v) => setBlock(selBlock.id, { repeat: v })} />
              <div>
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Rotate ({Math.round(selBlock.rot)}°)</span>
                <div className="flex flex-wrap gap-1">
                  {[-90, -15, -5, 5, 15, 90].map((r) => <button key={r} className="btn-secondary h-8 px-2 text-xs" onClick={() => setBlock(selBlock.id, { rot: (selBlock.rot + r + 360) % 360 })}>{r > 0 ? `⟳ ${r}°` : `⟲ ${-r}°`}</button>)}
                </div>
              </div>
            </>
          )}
          <p className="text-[11px] text-gray-500">Drag to move · arrow keys nudge (Shift = bigger steps) · Delete removes.</p>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => dup(selBlock)}>⧉ Duplicate</button>
            <button className="btn-ghost flex-1 text-red-700" onClick={() => del(selBlock)}>Delete</button>
          </div>
        </div>
      )}

      <details className="rounded-xl p-3 ring-1 ring-gray-200">
        <summary className="cursor-pointer font-semibold">⚡ Fill the roof automatically</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Num label="Panel Wp" value={a.wp} step={5} min={100} max={1000} onChange={(v) => setA("wp", v)} />
          <Num label="Tilt (°)" value={a.tilt} step={1} min={0} max={45} onChange={(v) => setA("tilt", v)} />
          <Num label="Facing (°)" value={a.azimuth} step={5} min={0} max={359} onChange={(v) => setA("azimuth", v)} />
          <Len label="Structure height" value={a.structureHeight} units={u} onChange={(m) => setA("structureHeight", m)} />
          <Len label="Row gap" value={Math.max(0.01, a.rowGap)} units={u} onChange={(m) => setA("rowGap", m)} />
          <Len label="Edge setback" value={Math.max(0.01, a.setback)} units={u} onChange={(m) => setA("setback", m)} />
        </div>
        <button className="btn-secondary mt-2 w-full" disabled={d.building.outline.length < 3} onClick={() => { update((x) => { x.blocks = autoFillBlocks(x); return x; }); setSel(null); }}>
          Fill roof (replaces current structures)
        </button>
      </details>

      {d.blocks.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Structures on this roof</div>
          <ul className="space-y-1">
            {d.blocks.map((b, i) => {
              const s = blockStats(b, metas);
              const bad = blockIssues(d, b, metas).length > 0;
              return (
                <li key={b.id}>
                  <button className={`flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-xs ${selBlock?.id === b.id ? "bg-orange-50" : "hover:bg-gray-50"}`} onClick={() => setSel({ kind: "block", id: b.id })}>
                    <span>{i + 1}. {b.kind === "param" ? `Structure ${b.rows}×${b.cols}` : metas[b.templateId]?.name ?? "Missing template"}{b.kind === "library" && b.repeat > 1 ? ` ×${b.repeat}` : ""}{bad ? " ⚠" : ""}</span>
                    <span className="tabular-nums text-gray-600">{s.panels} × {s.wp} Wp</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Obstructions & inverter

function ObstaclesTab({ d, update, sel, setSel, setObstacle, tool, setTool }: {
  d: Design; update: (fn: (x: Design) => Design) => void; sel: Obstacle | null; setSel: (s: Selection) => void;
  setObstacle: (id: string, patch: Partial<Obstacle>) => void; tool: Tool; setTool: (t: Tool) => void;
}) {
  const u = d.units;
  return (
    <>
      <p className="text-xs text-gray-500">Add everything that can cast shade. Click a button, then click the map. Drag to move.</p>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(OBSTACLE_PRESETS) as ObstacleKind[]).map((k) => (
          <button key={k} className={`btn-secondary px-2 py-2 text-xs ${tool === `place:obstacle:${k}` ? "ring-2 ring-brand-500" : ""}`} onClick={() => setTool(`place:obstacle:${k}`)}>+ {OBSTACLE_PRESETS[k].name}</button>
        ))}
      </div>
      {sel ? (
        <div className="space-y-3 rounded-xl p-3 ring-2 ring-orange-300">
          <input className="input" value={sel.name} onChange={(e) => setObstacle(sel.id, { name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Len label={sel.kind === "tank" || sel.kind === "tree" ? "Diameter" : "East–west size"} value={sel.w} units={u} onChange={(m) => setObstacle(sel.id, sel.kind === "tank" || sel.kind === "tree" ? { w: m, d: m } : { w: m })} />
            {sel.kind !== "tank" && sel.kind !== "tree" && <Len label="North–south size" value={sel.d} units={u} onChange={(m) => setObstacle(sel.id, { d: m })} />}
            <Len label="Height" value={sel.h} units={u} onChange={(m) => setObstacle(sel.id, { h: m })} />
            <Num label="Rotate (°)" value={sel.rot} step={5} min={-180} max={180} onChange={(v) => setObstacle(sel.id, { rot: v })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel.onRoof} onChange={(e) => setObstacle(sel.id, { onRoof: e.target.checked })} />
            Stands on the roof (untick if it stands on the ground)
          </label>
          <button className="btn-ghost w-full text-red-700" onClick={() => { update((x) => { x.obstacles = x.obstacles.filter((o) => o.id !== sel.id); return x; }); setSel(null); }}>Delete</button>
        </div>
      ) : (
        <ul className="space-y-1 text-xs text-gray-600">
          {d.obstacles.length === 0 && <li>No obstructions yet.</li>}
          {d.obstacles.map((o) => <li key={o.id}><button className="hover:underline" onClick={() => setSel({ kind: "obstacle", id: o.id })}>{o.name}</button> · {fmtLen(o.h, u)} {o.onRoof ? "on roof" : "from ground"}</li>)}
        </ul>
      )}
    </>
  );
}

function InverterTab({ d, update, kwp }: { d: Design; update: (fn: (x: Design) => Design) => void; kwp: number }) {
  const ratio = d.inverter?.kw ? kwp / d.inverter.kw : null;
  return (
    <>
      <div>
        <label className="label" htmlFor="inv">Inverter make & model</label>
        <input id="inv" className="input" placeholder="e.g. Growatt MIN 6000TL-X" value={d.inverter?.name ?? ""}
          onChange={(e) => update((x) => { x.inverter = { name: e.target.value, kw: x.inverter?.kw ?? Math.max(1, Math.round(kwp)) }; return x; })} />
      </div>
      <Num label="Inverter rating (kW AC)" value={d.inverter?.kw ?? 0} step={0.5} min={0} max={500} onChange={(v) => update((x) => { x.inverter = { name: x.inverter?.name ?? "", kw: v }; return x; })} />
      {ratio !== null && (
        <p className={`rounded-lg p-2 text-xs ${ratio < 0.9 || ratio > 1.35 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-800"}`}>
          DC/AC ratio {ratio.toFixed(2)} — {ratio < 0.9 ? "inverter is larger than needed" : ratio > 1.35 ? "inverter may be too small (clipping)" : "good match"} (usual range 0.9–1.35).
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 3D preview

function Preview3D({ d, metas }: { d: Design; metas: Record<string, TemplateMeta> }) {
  const [lib, setLib] = useState<LibraryModels | null>(null);
  useEffect(() => { let live = true; libraryFor(d, metas).then((l) => live && setLib(l)).catch(() => live && setLib({})); return () => { live = false; }; }, [d, metas]);
  const scene = useMemo(() => (lib ? buildDesignScene(d, lib) : null), [d, lib]);
  if (!scene) return <div className="flex h-full items-center justify-center text-sm text-gray-600">Loading structures…</div>;
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const r = box.isEmpty() ? 20 : Math.max(10, box.getSize(new THREE.Vector3()).length() / 2);
  return (
    <Canvas shadows camera={{ fov: 45, position: [c.x + r * 1.5, c.y + r * 1.4, c.z + r * 1.9], near: 0.1, far: r * 40 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#a5c8ec"]} />
      <hemisphereLight args={["#dbeafe", "#7c705a", 0.9]} />
      <directionalLight position={[c.x + r, c.y + r * 2, c.z + r]} intensity={2.2} castShadow />
      <Suspense fallback={null}>
        <primitive object={scene} />
        <mesh rotation-x={-Math.PI / 2} position={[c.x, -0.01, c.z]} receiveShadow>
          <circleGeometry args={[r * 4, 48]} />
          <meshStandardMaterial color="#cfc8b8" />
        </mesh>
      </Suspense>
      <OrbitControls makeDefault target={[c.x, c.y * 0.6, c.z]} maxPolarAngle={Math.PI / 2 - 0.03} />
    </Canvas>
  );
}
