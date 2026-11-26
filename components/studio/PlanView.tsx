"use client";
// Top-down plan on satellite imagery: roof outline with side lengths, obstructions, structure blocks
// (drag to move, drop from the palette, click panels to remove), roof tracing and a measure tool.
import { useCallback, useEffect, useRef, useState } from "react";
import { OBSTACLE_PRESETS, type Block, type Design, type ObstacleKind, type Pt, type TemplateMeta, uid } from "@/lib/design/types";
import { blockCorners, blockIssues, libraryModules, obstacleCorners, paramPanels } from "@/lib/design/layout";
import { edgesOf, snapOrtho } from "@/lib/design/outline";
import { bearingName, fmtLen } from "@/lib/design/units";

export type Tool = "select" | "outline" | "measure" | `place:obstacle:${ObstacleKind}` | `place:block:${string}`;
export type Selection = { kind: "block" | "obstacle"; id: string } | null;

const R = 6378137;
function mercator(lat: number, lng: number, z: number) {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
const metersPerPixel = (lat: number, z: number) => (2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
const r2 = (v: number) => Math.round(v * 100) / 100;
const poly = (pts: Pt[]) => pts.map((q) => q.join(",")).join(" ");

export function PlanView({ d, metas, tool, setTool, sel, setSel, update, tileUrl, snap, satellite, onPlace }: {
  d: Design; metas: Record<string, TemplateMeta>; tool: Tool; setTool: (t: Tool) => void;
  sel: Selection; setSel: (s: Selection) => void; update: (fn: (x: Design) => Design) => void;
  tileUrl: string; snap: boolean; satellite: number; onPlace: (what: string, at: Pt) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState({ cx: 0, cz: 0, scale: 12 });
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt | null } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const drag = useRef<{ kind: "pan" | "vertex" | "block" | "obstacle"; id?: string | number; sx: number; sz: number; ox: number; oz: number; moved: boolean; panel?: string } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Zoom to fit the roof when the page opens and whenever a new roof is drawn.
  const fit = useCallback(() => {
    const o = d.building.outline;
    if (o.length < 2 || !box.current) return;
    const xs = o.map((q) => q[0]), zs = o.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
    const scale = Math.min(120, Math.max(2, Math.min(box.current.clientWidth / (w * 1.8 || 1), box.current.clientHeight / (h * 1.8 || 1))));
    setCam({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cz: (Math.max(...zs) + Math.min(...zs)) / 2, scale });
  }, [d.building.outline]);
  const prevCount = useRef(-1);
  useEffect(() => {
    const n = d.building.outline.length;
    if ((prevCount.current === -1 && n >= 3) || (prevCount.current >= 0 && prevCount.current < 3 && n >= 3 && tool !== "outline")) fit();
    prevCount.current = n;
  }, [d.building.outline.length, fit, tool]);
  useEffect(() => { if (tool !== "measure") setMeasure(null); }, [tool]);

  const toM = useCallback((clientX: number, clientY: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [cam.cx + (clientX - r.left - size.w / 2) / cam.scale, cam.cz + (clientY - r.top - size.h / 2) / cam.scale];
  }, [cam, size]);
  const toS = (p: Pt): Pt => [size.w / 2 + (p[0] - cam.cx) * cam.scale, size.h / 2 + (p[1] - cam.cz) * cam.scale];

  // satellite tiles
  const zoom = Math.max(15, Math.min(19, Math.round(Math.log2((2 * Math.PI * R * Math.cos((d.site.lat * Math.PI) / 180) * cam.scale) / 256))));
  const mpp = metersPerPixel(d.site.lat, zoom);
  const origin = mercator(d.site.lat, d.site.lng, zoom);
  const tiles: { key: string; url: string; left: number; top: number; px: number }[] = [];
  if (satellite > 0) {
    const hw = size.w / 2 / cam.scale, hh = size.h / 2 / cam.scale;
    const gx0 = origin.x + (cam.cx - hw) / mpp, gx1 = origin.x + (cam.cx + hw) / mpp, gy0 = origin.y + (cam.cz - hh) / mpp, gy1 = origin.y + (cam.cz + hh) / mpp;
    for (let tx = Math.floor(gx0 / 256); tx <= Math.floor(gx1 / 256); tx++) {
      for (let ty = Math.floor(gy0 / 256); ty <= Math.floor(gy1 / 256); ty++) {
        const [left, top] = toS([(tx * 256 - origin.x) * mpp, (ty * 256 - origin.y) * mpp]);
        tiles.push({ key: `${zoom}/${tx}/${ty}`, url: tileUrl.replace("{z}", String(zoom)).replace("{x}", String(tx)).replace("{y}", String(ty)), left, top, px: 256 * mpp * cam.scale });
      }
    }
  }

  function onDown(e: React.PointerEvent) {
    let p = toM(e.clientX, e.clientY);
    const t = (e.target as Element).closest("[data-h]") as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "outline") {
      const o = d.building.outline;
      if (o.length >= 3 && Math.hypot(o[0][0] - p[0], o[0][1] - p[1]) * cam.scale < 12) { setTool("select"); return; }
      if (snap && o.length) p = snapOrtho(o[o.length - 1], p);
      update((q) => { q.building.outline.push([r2(p[0]), r2(p[1])]); return q; });
      return;
    }
    if (tool === "measure") { setMeasure((m) => (!m || m.b ? { a: p, b: null } : { a: m.a, b: p })); return; }
    if (tool.startsWith("place:")) {
      const [, what, which] = tool.split(":");
      if (what === "obstacle") {
        const id = uid();
        update((q) => { q.obstacles.push({ ...OBSTACLE_PRESETS[which as ObstacleKind], id, x: r2(p[0]), z: r2(p[1]) }); return q; });
        setSel({ kind: "obstacle", id });
      } else onPlace(which, p);
      setTool("select");
      return;
    }
    const kind = t?.dataset.h;
    if (kind === "vertex") drag.current = { kind: "vertex", id: Number(t!.dataset.i), sx: p[0], sz: p[1], ox: 0, oz: 0, moved: false };
    else if (kind === "obstacle") {
      const o = d.obstacles.find((q) => q.id === t!.dataset.id)!;
      setSel({ kind: "obstacle", id: o.id });
      drag.current = { kind: "obstacle", id: o.id, sx: p[0], sz: p[1], ox: o.x, oz: o.z, moved: false };
    } else if (kind === "block" || kind === "panel") {
      const b = d.blocks.find((q) => q.id === t!.dataset.id)!;
      const wasSelected = sel?.kind === "block" && sel.id === b.id;
      setSel({ kind: "block", id: b.id });
      drag.current = { kind: "block", id: b.id, sx: p[0], sz: p[1], ox: b.x, oz: b.z, moved: false, panel: kind === "panel" && wasSelected ? t!.dataset.key : undefined };
    } else drag.current = { kind: "pan", sx: e.clientX, sz: e.clientY, ox: cam.cx, oz: cam.cz, moved: false };
  }

  function onMove(e: React.PointerEvent) {
    const p = toM(e.clientX, e.clientY);
    if (tool === "outline" || tool === "measure") setHover(tool === "outline" && snap && d.building.outline.length ? snapOrtho(d.building.outline[d.building.outline.length - 1], p) : p);
    const g = drag.current;
    if (!g) return;
    if (g.kind === "pan") {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sz;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      setCam((c) => ({ ...c, cx: g.ox - dx / c.scale, cz: g.oz - dy / c.scale }));
      return;
    }
    if (Math.hypot(p[0] - g.sx, p[1] - g.sz) * cam.scale > 3) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "vertex") update((q) => { q.building.outline[g.id as number] = [r2(p[0]), r2(p[1])]; return q; });
    else if (g.kind === "obstacle") update((q) => { q.obstacles = q.obstacles.map((o) => (o.id === g.id ? { ...o, x: r2(g.ox + p[0] - g.sx), z: r2(g.oz + p[1] - g.sz) } : o)); return q; });
    else update((q) => { q.blocks = q.blocks.map((b) => (b.id === g.id ? { ...b, x: r2(g.ox + p[0] - g.sx), z: r2(g.oz + p[1] - g.sz) } : b)); return q; });
  }

  function onUp() {
    const g = drag.current;
    drag.current = null;
    if (!g || g.moved) return;
    if (g.kind === "pan") setSel(null);
    else if (g.kind === "block" && g.panel) {
      const key = g.panel;
      update((q) => {
        q.blocks = q.blocks.map((b) => {
          if (b.id !== g.id || b.kind !== "param") return b;
          const s = new Set(b.removed);
          if (s.has(key)) s.delete(key); else s.add(key);
          return { ...b, removed: [...s] };
        });
        return q;
      });
    }
  }

  function onWheel(e: React.WheelEvent) {
    const [mx, mz] = toM(e.clientX, e.clientY);
    const k = Math.exp(-e.deltaY * 0.0015);
    setCam((c) => {
      const scale = Math.min(120, Math.max(0.5, c.scale * k));
      return { scale, cx: mx - (mx - c.cx) * (c.scale / scale), cz: mz - (mz - c.cz) * (c.scale / scale) };
    });
  }

  function onDrop(e: React.DragEvent) {
    const what = e.dataTransfer.getData("text/evg-block");
    if (!what) return;
    e.preventDefault();
    onPlace(what, toM(e.clientX, e.clientY));
  }

  const tf = `translate(${size.w / 2 - cam.cx * cam.scale} ${size.h / 2 - cam.cz * cam.scale}) scale(${cam.scale})`;
  const ol = d.building.outline;
  const edges = edgesOf(ol);
  const cursor = tool === "select" ? "cursor-grab" : "cursor-crosshair";
  const label = (p: Pt, text: string, key: string, color = "#111827") => {
    const [x, y] = toS(p);
    return (
      <text key={key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill={color}
        stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" style={{ pointerEvents: "none" }}>{text}</text>
    );
  };

  return (
    <div ref={box} className={`absolute inset-0 select-none overflow-hidden bg-gray-300 ${cursor}`} style={{ touchAction: "none" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.key} src={t.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: t.left, top: t.top, width: t.px + 0.5, height: t.px + 0.5, opacity: satellite }} />
      ))}
      <svg className="absolute inset-0 h-full w-full">
        <g transform={tf}>
          {ol.length >= 2 && (
            <polygon points={poly(ol)} fill={ol.length >= 3 ? "rgba(255,255,255,0.22)" : "none"} stroke="#facc15" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeDasharray={tool === "outline" ? "6 4" : undefined} />
          )}
          {tool === "outline" && hover && ol.length > 0 && (
            <line x1={ol[ol.length - 1][0]} y1={ol[ol.length - 1][1]} x2={hover[0]} y2={hover[1]} stroke="#facc15" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          )}
          {d.obstacles.map((o) => (
            o.kind === "tank" || o.kind === "tree" ? (
              <circle key={o.id} data-h="obstacle" data-id={o.id} cx={o.x} cy={o.z} r={o.w / 2} fill={o.kind === "tree" ? "rgba(34,197,94,0.45)" : "rgba(17,24,39,0.7)"}
                stroke={sel?.id === o.id ? "#f97316" : "#fff"} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
            ) : (
              <polygon key={o.id} data-h="obstacle" data-id={o.id} points={poly(obstacleCorners(o))} fill={o.onRoof ? "rgba(234,179,8,0.45)" : "rgba(168,85,247,0.35)"}
                stroke={sel?.id === o.id ? "#f97316" : "#fff"} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
            )
          ))}
          {d.blocks.map((b) => <BlockShape key={b.id} b={b} d={d} metas={metas} selected={sel?.kind === "block" && sel.id === b.id} />)}
          {ol.map((q, i) => (
            <circle key={i} data-h="vertex" data-i={i} cx={q[0]} cy={q[1]} r={6 / cam.scale} fill={i === 0 && tool === "outline" ? "#facc15" : "#fff"} stroke="#111827" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
          ))}
          {measure && (measure.b || hover) && (
            <line x1={measure.a[0]} y1={measure.a[1]} x2={(measure.b ?? hover!)[0]} y2={(measure.b ?? hover!)[1]} stroke="#ec4899" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          )}
        </g>
        {/* labels in screen space so they stay readable at any zoom */}
        {edges.map((e) => label([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], `${bearingName(e.side)} ${fmtLen(e.length, d.units)}`, `e${e.i}`))}
        {d.blocks.map((b) => {
          const c = blockCorners(b, metas);
          if (!c.length) return null;
          const issues = blockIssues(d, b, metas);
          return issues.length ? label([b.x, b.z], "⚠ " + issues[0], `w${b.id}`, "#b91c1c") : null;
        })}
        {measure && (measure.b || hover) && (() => {
          const b = measure.b ?? hover!;
          return label([(measure.a[0] + b[0]) / 2, (measure.a[1] + b[1]) / 2], fmtLen(Math.hypot(b[0] - measure.a[0], b[1] - measure.a[1]), d.units), "m", "#be185d");
        })()}
      </svg>
      <div className="pointer-events-none absolute right-3 top-3 flex h-11 w-11 flex-col items-center justify-center rounded-full bg-white/95 text-[10px] font-bold text-red-600 shadow">▲<span className="-mt-0.5">N</span></div>
      <ScaleBar scale={cam.scale} units={d.units} />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <button className="btn-secondary h-9 w-9 p-0" onClick={() => setCam((c) => ({ ...c, scale: Math.min(120, c.scale * 1.4) }))}>+</button>
        <button className="btn-secondary h-9 w-9 p-0" onClick={() => setCam((c) => ({ ...c, scale: Math.max(0.5, c.scale / 1.4) }))}>−</button>
        <button className="btn-secondary h-9 w-9 p-0 text-xs" title="Zoom to the roof" onClick={fit}>⌖</button>
      </div>
    </div>
  );
}

function BlockShape({ b, d, metas, selected }: { b: Block; d: Design; metas: Record<string, TemplateMeta>; selected: boolean }) {
  const c = blockCorners(b, metas);
  if (!c.length) return null;
  const bad = blockIssues(d, b, metas).length > 0;
  const stroke = bad ? "#dc2626" : selected ? "#f97316" : "#93c5fd";
  return (
    <g>
      <polygon data-h="block" data-id={b.id} points={poly(c)} fill={selected ? "rgba(249,115,22,0.12)" : "rgba(30,58,138,0.10)"} stroke={stroke} strokeWidth={selected || bad ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
      {b.kind === "param"
        ? paramPanels(b).map((p) => (
          <polygon key={p.key} data-h="panel" data-id={b.id} data-key={p.key} points={poly(p.corners)}
            fill={p.removed ? "rgba(255,255,255,0.15)" : "rgba(30,58,138,0.88)"} stroke={p.removed ? "#fff" : "#bfdbfe"} strokeWidth={1}
            strokeDasharray={p.removed ? "3 3" : undefined} vectorEffect="non-scaling-stroke" style={{ cursor: selected ? "pointer" : "move" }} />
        ))
        : metas[b.templateId] && libraryModules(b, metas[b.templateId]).map((m, i) => (
          <polygon key={i} data-h="block" data-id={b.id} points={poly(m)} fill="rgba(30,58,138,0.88)" stroke="#bfdbfe" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ cursor: "move" }} />
        ))}
    </g>
  );
}

function ScaleBar({ scale, units }: { scale: number; units: "ft" | "m" }) {
  const unitM = units === "ft" ? 0.3048 : 1;
  const target = 120 / scale / unitM;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((n) => n >= target * 0.6) ?? 500;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 text-[10px] font-medium">
      <div className="h-1.5 border-x-2 border-b-2 border-gray-800" style={{ width: nice * unitM * scale }} />
      {nice} {units === "ft" ? "ft" : "m"}
    </div>
  );
}
