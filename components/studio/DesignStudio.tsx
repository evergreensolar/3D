"use client";
// Design Studio: design a rooftop system in the browser on satellite imagery — roof outline,
// floors, parapet, obstructions, automatic panel layout, inverter — then save it as a design
// version that goes through the same processing as an uploaded SketchUp model.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { newDesign, OBSTACLE_PRESETS, roofHeight, type Design, type Obstacle, type ObstacleKind, type Pt } from "@/lib/design/types";
import { layoutPanels, obstacleCorners, polygonArea } from "@/lib/design/layout";
import { buildDesignScene } from "@/lib/design/build3d";

type Tool = "select" | "outline" | `place:${ObstacleKind}`;
type Tab = "roof" | "obstacles" | "panels" | "inverter";

const R = 6378137;
function mercator(lat: number, lng: number, z: number) {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
const metersPerPixel = (lat: number, z: number) => (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);

export function DesignStudio(p: {
  projectId: string; projectCode: string; customerName: string;
  lat: number; lng: number; defaultWp: number;
  initial: Design | null; tileUrl: string; attribution: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<Design>(() => p.initial ?? newDesign(p.lat, p.lng, p.defaultWp));
  const [tool, setTool] = useState<Tool>(() => (p.initial?.building.outline.length ? "select" : "outline"));
  const [tab, setTab] = useState<Tab>("roof");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panels = useMemo(() => layoutPanels(d), [d]);
  const active = panels.filter((x) => !x.removed);
  const kwp = (active.length * d.array.wp) / 1000;
  const roofArea = polygonArea(d.building.outline);
  const ratio = d.inverter?.kw ? kwp / d.inverter.kw : null;
  const sel = d.obstacles.find((o) => o.id === selected) ?? null;

  const update = (fn: (x: Design) => Design) => setD((cur) => fn(structuredClone(cur)));
  const setArray = <K extends keyof Design["array"]>(k: K, v: Design["array"][K]) => update((x) => { x.array[k] = v; return x; });
  const setObstacle = (id: string, patch: Partial<Obstacle>) => update((x) => { x.obstacles = x.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)); return x; });

  async function save() {
    if (!active.length) { setError("Draw the roof and place at least one panel first."); return; }
    setError(null);
    try {
      setSaving("Building the 3D model…");
      const scene = buildDesignScene(d);
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

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col lg:flex-row">
      <div className="relative min-h-[55vh] flex-1 overflow-hidden bg-gray-200">
        {view === "2d" ? (
          <PlanView d={d} panels={panels} tool={tool} setTool={setTool} selected={selected} setSelected={setSelected} update={update}
            tileUrl={p.tileUrl} />
        ) : (
          <Preview3D d={d} />
        )}
        <div className="absolute left-3 top-3 flex gap-1 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-black/5">
          {(["2d", "3d"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${view === v ? "bg-brand-600 text-white" : "text-gray-700"}`}>
              {v === "2d" ? "Plan (satellite)" : "3D view"}
            </button>
          ))}
        </div>
        {view === "2d" && tool !== "select" && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-xl bg-gray-900/90 px-3 py-2 text-xs text-white shadow">
            {tool === "outline" ? (
              <>Click the roof corners one by one. {d.building.outline.length >= 3 && <button className="ml-2 font-semibold underline" onClick={() => setTool("select")}>Finish roof</button>}</>
            ) : <>Click on the map to place the {OBSTACLE_PRESETS[tool.slice(6) as ObstacleKind].name.toLowerCase()}. <button className="ml-2 underline" onClick={() => setTool("select")}>Cancel</button></>}
          </div>
        )}
        {view === "2d" && <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-white/90 drop-shadow">{p.attribution}</div>}
      </div>

      <aside className="flex max-h-[45vh] w-full flex-col border-t border-gray-200 bg-white lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="border-b border-gray-100 p-4">
          <div className="text-xs text-gray-500"><Link href={`/team/projects/${p.projectId}`} className="hover:underline">{p.projectCode}</Link> · {p.customerName}</div>
          <h1 className="text-lg font-semibold">Design Studio</h1>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="Panels" value={String(active.length)} />
            <Stat label="System" value={`${kwp.toFixed(2)} kWp`} />
            <Stat label="Roof" value={`${roofArea.toFixed(0)} m²`} />
          </div>
        </div>
        <div className="flex border-b border-gray-200 px-2 text-sm">
          {([["roof", "Roof"], ["obstacles", "Obstructions"], ["panels", "Panels"], ["inverter", "Inverter"]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px flex-1 border-b-2 px-1 py-2.5 font-semibold ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500"}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {tab === "roof" && (
            <>
              <p className="text-xs text-gray-500">Zoom the satellite view to the house (scroll / pinch, drag to move), then trace the roof edge. Drag the white corner dots to adjust.</p>
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" onClick={() => { update((x) => { x.building.outline = []; x.array.removed = []; return x; }); setTool("outline"); setView("2d"); }}>
                  {d.building.outline.length ? "Redraw roof" : "Draw roof"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Num label="Floors" value={d.building.floors} step={1} min={1} max={30} onChange={(v) => update((x) => { x.building.floors = v; return x; })} />
                <Num label="Floor height (m)" value={d.building.floorHeight} step={0.1} min={2.4} max={6} onChange={(v) => update((x) => { x.building.floorHeight = v; return x; })} />
                <Num label="Parapet (m)" value={d.building.parapet} step={0.1} min={0} max={3} onChange={(v) => update((x) => { x.building.parapet = v; return x; })} />
              </div>
              <p className="text-xs text-gray-500">Roof level: {roofHeight(d).toFixed(1)} m above ground.</p>
            </>
          )}

          {tab === "obstacles" && (
            <>
              <p className="text-xs text-gray-500">Add everything that can cast shade. Click a button, then click on the map. Drag to move.</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(OBSTACLE_PRESETS) as ObstacleKind[]).map((k) => (
                  <button key={k} className={`btn-secondary px-2 py-2 text-xs ${tool === `place:${k}` ? "ring-2 ring-brand-500" : ""}`} onClick={() => { setTool(`place:${k}`); setView("2d"); }}>
                    + {OBSTACLE_PRESETS[k].name}
                  </button>
                ))}
              </div>
              {sel ? (
                <div className="space-y-3 rounded-xl p-3 ring-1 ring-gray-200">
                  <input className="input" value={sel.name} onChange={(e) => setObstacle(sel.id, { name: e.target.value })} />
                  <div className="grid grid-cols-3 gap-2">
                    <Num label={sel.kind === "tank" || sel.kind === "tree" ? "Diameter" : "Width (m)"} value={sel.w} step={0.1} min={0.2} max={100}
                      onChange={(v) => setObstacle(sel.id, sel.kind === "tank" || sel.kind === "tree" ? { w: v, d: v } : { w: v })} />
                    {sel.kind !== "tank" && sel.kind !== "tree" && <Num label="Depth (m)" value={sel.d} step={0.1} min={0.2} max={100} onChange={(v) => setObstacle(sel.id, { d: v })} />}
                    <Num label="Height (m)" value={sel.h} step={0.1} min={0.1} max={150} onChange={(v) => setObstacle(sel.id, { h: v })} />
                    <Num label="Rotate (°)" value={sel.rot} step={5} min={-180} max={180} onChange={(v) => setObstacle(sel.id, { rot: v })} />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={sel.onRoof} onChange={(e) => setObstacle(sel.id, { onRoof: e.target.checked })} />
                    Stands on the roof (untick if it stands on the ground)
                  </label>
                  <button className="btn-ghost w-full text-red-700" onClick={() => { update((x) => { x.obstacles = x.obstacles.filter((o) => o.id !== sel.id); return x; }); setSelected(null); }}>Delete</button>
                </div>
              ) : (
                <ul className="space-y-1 text-xs text-gray-600">
                  {d.obstacles.length === 0 && <li>No obstructions yet.</li>}
                  {d.obstacles.map((o) => (
                    <li key={o.id}><button className="hover:underline" onClick={() => setSelected(o.id)}>{o.name}</button> · {o.h} m {o.onRoof ? "on roof" : "from ground"}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "panels" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Num label="Panel Wp" value={d.array.wp} step={5} min={100} max={1000} onChange={(v) => setArray("wp", v)} />
                <Num label="Length (m)" value={d.array.panelL} step={0.001} min={1} max={3} onChange={(v) => setArray("panelL", v)} />
                <Num label="Width (m)" value={d.array.panelW} step={0.001} min={0.5} max={1.6} onChange={(v) => setArray("panelW", v)} />
                <Num label="Tilt (°)" value={d.array.tilt} step={1} min={0} max={45} onChange={(v) => setArray("tilt", v)} />
                <Num label="Facing (°)" value={d.array.azimuth} step={5} min={0} max={359} onChange={(v) => setArray("azimuth", v)} />
                <Num label="Structure ht (m)" value={d.array.structureHeight} step={0.1} min={0.1} max={6} onChange={(v) => setArray("structureHeight", v)} />
                <Num label="Row gap (m)" value={d.array.rowGap} step={0.05} min={0} max={10} onChange={(v) => setArray("rowGap", v)} />
                <Num label="Panel gap (m)" value={d.array.colGap} step={0.01} min={0} max={1} onChange={(v) => setArray("colGap", v)} />
                <Num label="Edge setback (m)" value={d.array.setback} step={0.05} min={0} max={5} onChange={(v) => setArray("setback", v)} />
              </div>
              <div className="flex gap-2">
                {(["portrait", "landscape"] as const).map((o) => (
                  <button key={o} onClick={() => setArray("orientation", o)} className={`chip ${d.array.orientation === o ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-300"}`}>{o === "portrait" ? "Portrait" : "Landscape"}</button>
                ))}
              </div>
              <p className="text-xs text-gray-500">Facing: 180° = south (best in West Bengal). Panels fill the roof automatically, avoiding obstructions. Click a panel on the plan to remove it, click again to put it back.</p>
              {d.array.removed.length > 0 && <button className="btn-ghost w-full text-xs" onClick={() => setArray("removed", [])}>Restore {d.array.removed.length} removed panel(s)</button>}
            </>
          )}

          {tab === "inverter" && (
            <>
              <div>
                <label className="label" htmlFor="inv">Inverter make & model</label>
                <input id="inv" className="input" placeholder="e.g. Growatt MIN 6000TL-X" value={d.inverter?.name ?? ""}
                  onChange={(e) => update((x) => { x.inverter = { name: e.target.value, kw: x.inverter?.kw ?? Math.max(1, Math.round(kwp)) }; return x; })} />
              </div>
              <Num label="Inverter rating (kW AC)" value={d.inverter?.kw ?? 0} step={0.5} min={0} max={500}
                onChange={(v) => update((x) => { x.inverter = { name: x.inverter?.name ?? "", kw: v }; return x; })} />
              {ratio !== null && (
                <p className={`rounded-lg p-2 text-xs ${ratio < 0.9 || ratio > 1.35 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-800"}`}>
                  DC/AC ratio {ratio.toFixed(2)} — {ratio < 0.9 ? "inverter is larger than needed" : ratio > 1.35 ? "inverter may be too small (clipping)" : "good match"} (usual range 0.9–1.35).
                </p>
              )}
            </>
          )}
        </div>
        <div className="border-t border-gray-100 p-4">
          {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          <button className="btn-primary w-full py-3" disabled={!!saving} onClick={save}>{saving ?? `Save design (${active.length} panels, ${kwp.toFixed(2)} kWp)`}</button>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-brand-50 px-2 py-1.5"><div className="text-[10px] text-gray-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>;
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

// ---------------------------------------------------------------- 2D plan on satellite imagery

function PlanView({ d, panels, tool, setTool, selected, setSelected, update, tileUrl }: {
  d: Design; panels: ReturnType<typeof layoutPanels>; tool: Tool; setTool: (t: Tool) => void;
  selected: string | null; setSelected: (id: string | null) => void; update: (fn: (x: Design) => Design) => void; tileUrl: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState({ cx: 0, cz: 0, scale: 9 }); // px per metre
  const drag = useRef<{ kind: "pan" | "vertex" | "obstacle"; id?: string | number; sx: number; sz: number; cx: number; cz: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // centre on the roof if there is one
  useEffect(() => {
    const o = d.building.outline;
    if (o.length) setCam((c) => ({ ...c, cx: o.reduce((s, q) => s + q[0], 0) / o.length, cz: o.reduce((s, q) => s + q[1], 0) / o.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toM = useCallback((clientX: number, clientY: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [cam.cx + (clientX - r.left - size.w / 2) / cam.scale, cam.cz + (clientY - r.top - size.h / 2) / cam.scale];
  }, [cam, size]);

  // satellite tiles
  const zoom = Math.max(15, Math.min(19, Math.round(Math.log2((2 * Math.PI * R * Math.cos((d.site.lat * Math.PI) / 180) * cam.scale) / 256))));
  const mpp = metersPerPixel(d.site.lat, zoom);
  const origin = mercator(d.site.lat, d.site.lng, zoom);
  const tiles: { key: string; url: string; left: number; top: number; px: number }[] = [];
  const halfWm = size.w / 2 / cam.scale, halfHm = size.h / 2 / cam.scale;
  const gx0 = origin.x + (cam.cx - halfWm) / mpp, gx1 = origin.x + (cam.cx + halfWm) / mpp;
  const gy0 = origin.y + (cam.cz - halfHm) / mpp, gy1 = origin.y + (cam.cz + halfHm) / mpp;
  const tilePx = (256 * mpp) * cam.scale;
  for (let tx = Math.floor(gx0 / 256); tx <= Math.floor(gx1 / 256); tx++) {
    for (let ty = Math.floor(gy0 / 256); ty <= Math.floor(gy1 / 256); ty++) {
      const mx = (tx * 256 - origin.x) * mpp, mz = (ty * 256 - origin.y) * mpp;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: tileUrl.replace("{z}", String(zoom)).replace("{x}", String(tx)).replace("{y}", String(ty)),
        left: size.w / 2 + (mx - cam.cx) * cam.scale, top: size.h / 2 + (mz - cam.cz) * cam.scale, px: tilePx,
      });
    }
  }

  function onDown(e: React.PointerEvent) {
    const [x, z] = toM(e.clientX, e.clientY);
    const target = (e.target as Element).closest("[data-h]") as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "outline") {
      const o = d.building.outline;
      if (o.length >= 3 && Math.hypot(o[0][0] - x, o[0][1] - z) * cam.scale < 12) { setTool("select"); return; }
      update((q) => { q.building.outline.push([round2(x), round2(z)]); return q; });
      return;
    }
    if (tool.startsWith("place:")) {
      const k = tool.slice(6) as ObstacleKind;
      const id = Math.random().toString(36).slice(2, 9);
      update((q) => { q.obstacles.push({ ...OBSTACLE_PRESETS[k], id, x: round2(x), z: round2(z) }); return q; });
      setSelected(id);
      setTool("select");
      return;
    }
    if (target?.dataset.h === "vertex") drag.current = { kind: "vertex", id: Number(target.dataset.i), sx: x, sz: z, cx: 0, cz: 0, moved: false };
    else if (target?.dataset.h === "obstacle") {
      const o = d.obstacles.find((q) => q.id === target.dataset.id)!;
      setSelected(o.id);
      drag.current = { kind: "obstacle", id: o.id, sx: x, sz: z, cx: o.x, cz: o.z, moved: false };
    } else drag.current = { kind: "pan", sx: e.clientX, sz: e.clientY, cx: cam.cx, cz: cam.cz, moved: false, id: target?.dataset.h === "panel" ? target.dataset.key : undefined };
  }

  function onMove(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    if (g.kind === "pan") {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sz;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      setCam((c) => ({ ...c, cx: g.cx - dx / c.scale, cz: g.cz - dy / c.scale }));
      return;
    }
    const [x, z] = toM(e.clientX, e.clientY);
    g.moved = true;
    if (g.kind === "vertex") update((q) => { q.building.outline[g.id as number] = [round2(x), round2(z)]; return q; });
    else update((q) => { q.obstacles = q.obstacles.map((o) => (o.id === g.id ? { ...o, x: round2(g.cx + x - g.sx), z: round2(g.cz + z - g.sz) } : o)); return q; });
  }

  function onUp() {
    const g = drag.current;
    drag.current = null;
    if (g?.kind === "pan" && !g.moved) {
      if (g.id) update((q) => { const s = new Set(q.array.removed); if (s.has(g.id as string)) s.delete(g.id as string); else s.add(g.id as string); q.array.removed = [...s]; return q; });
      else setSelected(null);
    }
  }

  function onWheel(e: React.WheelEvent) {
    const [mx, mz] = toM(e.clientX, e.clientY);
    const k = Math.exp(-e.deltaY * 0.0015);
    setCam((c) => {
      const scale = Math.min(80, Math.max(0.5, c.scale * k));
      return { scale, cx: mx - (mx - c.cx) * (c.scale / scale), cz: mz - (mz - c.cz) * (c.scale / scale) };
    });
  }

  const tf = `translate(${size.w / 2 - cam.cx * cam.scale} ${size.h / 2 - cam.cz * cam.scale}) scale(${cam.scale})`;
  const ol = d.building.outline;
  return (
    <div ref={box} className={`absolute inset-0 select-none ${tool === "select" ? "cursor-grab" : "cursor-crosshair"}`} style={{ touchAction: "none" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}>
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: t.left, top: t.top, width: t.px + 0.5, height: t.px + 0.5 }} />
      ))}
      <svg className="absolute inset-0 h-full w-full">
        <g transform={tf}>
          {ol.length >= 2 && (
            <polygon points={ol.map((q) => q.join(",")).join(" ")} fill={ol.length >= 3 ? "rgba(255,255,255,0.18)" : "none"} stroke="#facc15" strokeWidth={2} vectorEffect="non-scaling-stroke"
              strokeDasharray={tool === "outline" ? "6 4" : undefined} />
          )}
          {panels.map((pn) => (
            <polygon key={pn.key} data-h="panel" data-key={pn.key} points={pn.corners.map((q) => q.join(",")).join(" ")}
              fill={pn.removed ? "rgba(255,255,255,0.15)" : "rgba(30,58,138,0.85)"} stroke={pn.removed ? "#ffffff" : "#bfdbfe"} strokeWidth={1}
              strokeDasharray={pn.removed ? "3 3" : undefined} vectorEffect="non-scaling-stroke" style={{ cursor: "pointer" }} />
          ))}
          {d.obstacles.map((o) => (
            o.kind === "tank" || o.kind === "tree" ? (
              <circle key={o.id} data-h="obstacle" data-id={o.id} cx={o.x} cy={o.z} r={o.w / 2}
                fill={o.kind === "tree" ? "rgba(34,197,94,0.45)" : "rgba(17,24,39,0.7)"} stroke={selected === o.id ? "#f97316" : "#fff"} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
            ) : (
              <polygon key={o.id} data-h="obstacle" data-id={o.id} points={obstacleCorners(o).map((q) => q.join(",")).join(" ")}
                fill={o.onRoof ? "rgba(234,179,8,0.45)" : "rgba(168,85,247,0.35)"} stroke={selected === o.id ? "#f97316" : "#fff"} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
            )
          ))}
          {ol.map((q, i) => (
            <circle key={i} data-h="vertex" data-i={i} cx={q[0]} cy={q[1]} r={6 / cam.scale} fill={i === 0 && tool === "outline" ? "#facc15" : "#fff"} stroke="#111827" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-xs font-bold text-red-600 shadow">N↑</div>
      <ScaleBar scale={cam.scale} />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <button className="btn-secondary h-9 w-9 p-0" onClick={() => setCam((c) => ({ ...c, scale: Math.min(80, c.scale * 1.4) }))}>+</button>
        <button className="btn-secondary h-9 w-9 p-0" onClick={() => setCam((c) => ({ ...c, scale: Math.max(0.5, c.scale / 1.4) }))}>−</button>
      </div>
    </div>
  );
}

function ScaleBar({ scale }: { scale: number }) {
  const target = 120 / scale;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200].find((n) => n >= target * 0.6) ?? 200;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 text-[10px] font-medium">
      <div className="h-1.5 border-x-2 border-b-2 border-gray-800" style={{ width: nice * scale }} />
      {nice} m
    </div>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- 3D preview

function Preview3D({ d }: { d: Design }) {
  const scene = useMemo(() => buildDesignScene(d), [d]);
  const box = useMemo(() => new THREE.Box3().setFromObject(scene), [scene]);
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
