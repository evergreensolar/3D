"use client";
// Panel tagging editor: open the original SketchUp export, click parts of the model and mark them
// as panels with their Wp. Saved tags drive panel count, kW, shading, generation and the PDF.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as THREE from "three";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { loadModel, type ModelFormat } from "@/lib/scene/load";
import { prepareModel } from "@/lib/scene/stage";
import { collectMeshes, detectPanels, nodeAtPath, nodePath, nodeTriangles, shapeOf, type PanelTag } from "@/lib/scene/panels";

const TAG_COLOR = new THREE.Color("#16a34a");
const SEL_COLOR = new THREE.Color("#2563eb");
const PICK_MAX = 2.9; // m — a click selects the largest part up to panel size

type Tags = Map<string, { wp: number; name: string }>;

const isAncestor = (a: string, b: string) => a !== b && (a === "" || b.startsWith(a + "."));
const baseName = (o: THREE.Object3D) => `${o.userData?.name || o.name || ""}`.replace(/[#_.\s-]*\d+$/, "").trim().toLowerCase();
const label = (o: THREE.Object3D) => `${o.userData?.name || o.name || "(unnamed)"}`;

const boxCache = new WeakMap<THREE.Object3D, THREE.Box3>();
function boxOf(o: THREE.Object3D) {
  let b = boxCache.get(o);
  if (!b) { b = new THREE.Box3().setFromObject(o); boxCache.set(o, b); }
  return b;
}
const maxDim = (o: THREE.Object3D) => { const s = boxOf(o).getSize(new THREE.Vector3()); return Math.max(s.x, s.y, s.z); };

function tintMesh(mesh: THREE.Mesh, color: THREE.Color | null) {
  const ud = mesh.userData as { __orig?: THREE.Material | THREE.Material[]; __tints?: Record<string, THREE.Material | THREE.Material[]> };
  if (!ud.__orig) ud.__orig = mesh.material;
  if (!color) { mesh.material = ud.__orig; return; }
  const key = color.getHexString();
  ud.__tints ??= {};
  if (!ud.__tints[key]) {
    const make = (m: THREE.Material) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (c.emissive) { c.emissive = color.clone(); c.emissiveIntensity = 0.55; }
      else if ((c as unknown as { color?: THREE.Color }).color) (c as unknown as { color: THREE.Color }).color.lerp(color, 0.6);
      return c;
    };
    ud.__tints[key] = Array.isArray(ud.__orig) ? ud.__orig.map(make) : make(ud.__orig);
  }
  mesh.material = ud.__tints[key];
}

export function PanelEditor(p: {
  projectId: string; projectCode: string; versionId: string; versionNumber: number; locked: boolean;
  modelUrl: string; format: ModelFormat; defaultWp: number; initialTags: PanelTag[] | null;
}) {
  const router = useRouter();
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [tags, setTags] = useState<Tags>(new Map());
  const [auto, setAuto] = useState(false);
  const [unaddressable, setUnaddressable] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [chain, setChain] = useState<{ nodes: THREE.Object3D[]; level: number } | null>(null);
  const [multi, setMulti] = useState(false);
  const [wp, setWp] = useState(String(p.defaultWp));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load the ORIGINAL upload and prepare it exactly like processing does (so node paths match).
  useEffect(() => {
    let live = true;
    loadModel(p.modelUrl, p.format, (f) => live && setProgress(Math.round(f * 100)))
      .then((r) => {
        if (!live) return;
        prepareModel(r);
        r.updateMatrixWorld(true);
        const t: Tags = new Map();
        if (p.initialTags?.length) {
          p.initialTags.forEach((x) => nodeAtPath(r, x.path) && t.set(x.path, { wp: x.wp, name: x.name ?? "" }));
        } else {
          const found = detectPanels(r);
          found.forEach((x) => x.path !== undefined && t.set(x.path, { wp: p.defaultWp, name: x.name }));
          setUnaddressable(found.filter((x) => x.path === undefined).length);
          setAuto(true);
        }
        setTags(t);
        setRoot(r);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [p.modelUrl, p.format, p.initialTags, p.defaultWp]);

  // Colour tagged (green) and selected (blue) parts.
  useEffect(() => {
    if (!root) return;
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) tintMesh(o as THREE.Mesh, null); });
    for (const path of tags.keys()) { const n = nodeAtPath(root, path); if (n) collectMeshes(n).forEach((m) => tintMesh(m, TAG_COLOR)); }
    for (const path of sel) { const n = nodeAtPath(root, path); if (n) collectMeshes(n).forEach((m) => tintMesh(m, SEL_COLOR)); }
  }, [root, tags, sel]);

  const onPick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!root || e.delta > 6) return;
    e.stopPropagation();
    // Walk up from the clicked mesh to the largest ancestor that is still panel-sized.
    const nodes: THREE.Object3D[] = [];
    let n: THREE.Object3D | null = e.object;
    while (n && n !== root) { nodes.push(n); n = n.parent; }
    let level = 0;
    for (let i = 0; i < nodes.length; i++) if (maxDim(nodes[i]) <= PICK_MAX) level = i;
    const path = nodePath(root, nodes[level]);
    setChain({ nodes, level });
    setSel((s) => (multi || e.shiftKey || e.ctrlKey || e.metaKey ? (s.includes(path) ? s.filter((x) => x !== path) : [...s, path]) : [path]));
  }, [root, multi]);

  const moveLevel = (d: number) => {
    if (!root || !chain) return;
    const level = Math.min(chain.nodes.length - 1, Math.max(0, chain.level + d));
    setChain({ ...chain, level });
    setSel([nodePath(root, chain.nodes[level])]);
  };

  const selected = sel.length === 1 && root ? nodeAtPath(root, sel[0]) : null;
  const shape = useMemo(() => (selected ? shapeOf(nodeTriangles(selected)) : null), [selected]);

  function findSimilar(kind: "name" | "size") {
    if (!root || !selected) return;
    setBusy(kind);
    setTimeout(() => {
      const matches: string[] = [];
      const ref = kind === "name" ? baseName(selected) : null;
      const refShape = kind === "size" ? shape : null;
      const visit = (o: THREE.Object3D) => {
        if (o !== root && collectMeshes(o).length) {
          let ok = false;
          if (ref) ok = baseName(o) === ref;
          else if (refShape && maxDim(o) <= PICK_MAX && maxDim(o) >= 0.3) {
            const s = shapeOf(nodeTriangles(o));
            ok = !!s && Math.abs(s.long - refShape.long) < 0.03 && Math.abs(s.short - refShape.short) < 0.03 && Math.abs(s.thick - refShape.thick) < 0.02;
          }
          if (ok) { matches.push(nodePath(root, o)); return; } // topmost only
        }
        o.children.forEach(visit);
      };
      visit(root);
      setSel(matches.length ? matches : sel);
      setMsg({ ok: true, text: `${matches.length} matching part${matches.length === 1 ? "" : "s"} selected` });
      setBusy(null);
    }, 20);
  }

  function mark() {
    const w = Math.round(Number(wp));
    if (!(w >= 50 && w <= 1000)) { setMsg({ ok: false, text: "Enter the panel rating in Wp (50–1000)" }); return; }
    if (!root) return;
    setTags((t) => {
      const next = new Map(t);
      for (const path of sel) {
        // a part can't be counted twice: drop tags above or below it
        for (const k of [...next.keys()]) if (isAncestor(k, path) || isAncestor(path, k)) next.delete(k);
        next.set(path, { wp: w, name: label(nodeAtPath(root, path)!) });
      }
      return next;
    });
    setDirty(true); setAuto(false);
    setMsg({ ok: true, text: `${sel.length} marked as ${w} Wp panel${sel.length === 1 ? "" : "s"}` });
  }

  function unmark() {
    setTags((t) => { const next = new Map(t); sel.forEach((s) => next.delete(s)); return next; });
    setDirty(true); setAuto(false);
  }

  async function save(useAuto: boolean) {
    setBusy("save"); setMsg(null);
    const body = useAuto ? { tags: null } : { tags: [...tags].map(([path, t]) => ({ path, wp: t.wp, name: t.name.slice(0, 200) })) };
    const r = await fetch(`/api/team/versions/${p.versionId}/panels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(null); setMsg({ ok: false, text: j.error ?? "Could not save" }); return; }
    router.push(`/team/projects/${p.projectId}`);
    router.refresh();
  }

  const totalWp = [...tags.values()].reduce((s, t) => s + t.wp, 0);
  const byWp = [...tags.values()].reduce((m, t) => m.set(t.wp, (m.get(t.wp) ?? 0) + 1), new Map<number, number>());
  const selectedTag = sel.length === 1 ? tags.get(sel[0]) : undefined;

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col lg:flex-row">
      <div className="relative min-h-[50vh] flex-1 bg-sky-100">
        {root ? (
          <Canvas camera={{ fov: 45 }} dpr={[1, 2]} style={{ touchAction: "none" }} onPointerMissed={() => !multi && setSel([])}>
            <Suspense fallback={null}>
              <ambientLight intensity={0.9} />
              <directionalLight position={[20, 40, 25]} intensity={1.6} />
              <primitive object={root} onClick={onPick} />
              <FitCamera root={root} />
              <OrbitControls makeDefault enableDamping />
            </Suspense>
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-600">
            {loadError ? <span className="text-red-700">Could not open the model: {loadError}</span> : <>Opening the uploaded model… {progress ? `${progress}%` : ""}</>}
          </div>
        )}
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/90 px-3 py-2 text-xs shadow-sm ring-1 ring-black/5">
          <span className="mr-3"><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#16a34a" }} />Panel</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#2563eb" }} />Selected</span>
        </div>
      </div>

      <aside className="max-h-[50vh] w-full overflow-y-auto border-t border-gray-200 bg-white p-4 lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
        <div className="text-xs text-gray-500"><Link href={`/team/projects/${p.projectId}`} className="hover:underline">{p.projectCode}</Link> / Version {p.versionNumber}</div>
        <h1 className="text-lg font-semibold">Tag panels</h1>
        <p className="mt-1 text-xs text-gray-500">Click a panel in the model. Mark it with its Wp, then use “same name” or “same size” to select all the others in one go.</p>

        <div className="mt-4 rounded-xl bg-brand-50 p-3">
          <div className="text-2xl font-semibold tabular-nums">{tags.size} <span className="text-sm font-normal text-gray-600">panels</span> · {(totalWp / 1000).toFixed(2)} <span className="text-sm font-normal text-gray-600">kWp</span></div>
          {byWp.size > 0 && <div className="mt-1 text-xs text-gray-600">{[...byWp].sort((a, b) => b[0] - a[0]).map(([w, c]) => `${c} × ${w} Wp`).join(" · ")}</div>}
          {auto && <div className="mt-1 text-xs text-gray-600">Found automatically — check and correct, then save.</div>}
          {unaddressable > 0 && <div className="mt-1 text-xs text-amber-800">{unaddressable} more panel(s) were found by material only; tag them by clicking if you switch to manual tags.</div>}
        </div>

        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Selection</h2>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
              Select several (or Shift+click)
            </label>
          </div>
          {sel.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing selected — click a part of the model.</p>
          ) : sel.length === 1 && selected ? (
            <div className="rounded-lg ring-1 ring-gray-200 p-3 text-sm">
              <div className="font-medium break-all">{label(selected)}</div>
              {shape && <div className="text-xs text-gray-500">{(shape.long * 1000).toFixed(0)} × {(shape.short * 1000).toFixed(0)} × {(shape.thick * 1000).toFixed(0)} mm</div>}
              <div className="text-xs text-gray-500">{selectedTag ? `Tagged: ${selectedTag.wp} Wp panel` : "Not a panel"}</div>
              {chain && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={chain.level >= chain.nodes.length - 1} onClick={() => moveLevel(1)}>Up one level (bigger)</button>
                  <button className="btn-secondary px-3 py-1.5 text-xs" disabled={chain.level === 0} onClick={() => moveLevel(-1)}>Down one level</button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm">{sel.length} parts selected</p>
          )}

          {selected && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => findSimilar("name")}>{busy === "name" ? "Searching…" : "Select all with same name"}</button>
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => findSimilar("size")}>{busy === "size" ? "Searching…" : "Select all with same size"}</button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="w-28">
              <label className="label" htmlFor="wp">Panel Wp</label>
              <input id="wp" className="input" inputMode="numeric" value={wp} onChange={(e) => setWp(e.target.value)} />
            </div>
            <button className="btn-primary flex-1" disabled={!sel.length || p.locked} onClick={mark}>Mark {sel.length > 1 ? `${sel.length} ` : ""}as panel</button>
          </div>
          <button className="btn-ghost w-full text-red-700" disabled={!sel.some((s) => tags.has(s)) || p.locked} onClick={unmark}>Remove from panels</button>
        </section>

        {msg && <p className={`mt-3 rounded-lg p-2 text-xs ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

        <section className="mt-6 space-y-2 border-t border-gray-100 pt-4">
          {p.locked ? <p className="text-sm text-amber-800">This version is approved and locked.</p> : (
            <>
              <button className="btn-primary w-full py-3" disabled={!!busy || !root || tags.size === 0} onClick={() => save(false)}>
                {busy === "save" ? "Saving…" : `Save ${tags.size} panels & recalculate`}
              </button>
              <button className="btn-ghost w-full text-xs" disabled={!!busy} onClick={() => save(true)}>Use automatic detection instead</button>
              {dirty && <p className="text-center text-xs text-gray-500">Unsaved changes</p>}
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function FitCamera({ root }: { root: THREE.Object3D }) {
  const { camera, controls } = useThree();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !controls) return;
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    camera.position.set(c.x + r * 0.9, c.y + r * 0.9, c.z + r * 1.1);
    (camera as THREE.PerspectiveCamera).near = r / 500;
    (camera as THREE.PerspectiveCamera).far = r * 50;
    camera.updateProjectionMatrix();
    const oc = controls as unknown as { target: THREE.Vector3; update: () => void };
    oc.target.copy(c);
    oc.update();
    done.current = true;
  }, [root, camera, controls]);
  return null;
}
