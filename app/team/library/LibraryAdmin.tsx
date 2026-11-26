"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeTemplate, type AnalyzedTemplate } from "@/lib/design/analyzeTemplate";
import { fmtLen } from "@/lib/design/units";

type Item = { id: string; name: string; wp: number; panelCount: number; w: number; d: number; h: number; thumbUrl?: string; active: boolean; description: string | null };

export function LibraryAdmin({ items }: { items: Item[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [a, setA] = useState<AnalyzedTemplate | null>(null);
  const [name, setName] = useState("");
  const [wp, setWp] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(f: File | null) {
    setFile(f); setA(null); setMsg(null);
    if (!f) return;
    setBusy("Reading the model…");
    try {
      const r = await analyzeTemplate(f);
      setA(r);
      setName((n) => n || f.name.replace(/\.glb$/i, "").replace(/[_-]+/g, " "));
      setWp((w) => w || String(r.suggestedWp ?? ""));
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(null);
  }

  async function save() {
    if (!file || !a) return;
    setBusy("Uploading…"); setMsg(null);
    try {
      const start = await fetch("/api/team/uploads", { method: "POST" }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? "Upload failed");
      const n = Math.ceil(file.size / start.chunkBytes);
      for (let i = 0; i < n; i++) {
        const r = await fetch(`/api/team/uploads/${start.id}?index=${i}`, { method: "PUT", body: file.slice(i * start.chunkBytes, (i + 1) * start.chunkBytes) });
        if (!r.ok) throw new Error("Upload interrupted — try again");
      }
      const { thumb, suggestedWp: _s, warning: _w, ...meta } = a;
      const r = await fetch("/api/team/library", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: start.id, chunks: n, name, wp: Number(wp), description: desc || undefined, meta, thumb }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not save");
      setMsg({ ok: true, text: `Added “${name}” to the library.` });
      setFile(null); setA(null); setName(""); setWp(""); setDesc("");
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(null);
  }

  async function toggle(it: Item) {
    await fetch(`/api/team/library/${it.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !it.active }) });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className="font-semibold">Add a structure with modules</h2>
        <p className="mt-1 text-xs text-gray-500">Export the structure + panels from SketchUp as <b>.glb</b>, with the panels facing south. Name each module “Solar Panel …” or “Module …” (e.g. “Module 550Wp”).</p>
        <input type="file" accept=".glb" className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-700" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        {a && (
          <div className="mt-4 grid gap-4 sm:grid-cols-[240px_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.thumb} alt="" className="w-full rounded-lg ring-1 ring-gray-200" />
            <div className="space-y-3">
              <p className="text-sm"><b>{a.panelCount} modules</b> found · footprint {fmtLen(a.w, "ft")} × {fmtLen(a.d, "ft")} · height {fmtLen(a.h, "ft")}</p>
              {a.warning && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{a.warning}</p>}
              <input className="input" placeholder="Name, e.g. Elevated GI 2×3 (6 × 550 Wp)" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="flex items-center gap-2">
                <input className="input w-32" inputMode="numeric" placeholder="Wp" value={wp} onChange={(e) => setWp(e.target.value)} />
                <span className="text-sm text-gray-600">Wp per module = {wp ? ((a.panelCount * Number(wp)) / 1000).toFixed(2) : "–"} kWp per structure</span>
              </div>
              <input className="input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
              <button className="btn-primary" disabled={!!busy || name.length < 2 || !(Number(wp) >= 50)} onClick={save}>Add to library</button>
            </div>
          </div>
        )}
        {busy && <p className="mt-3 text-sm text-gray-600">{busy}</p>}
        {msg && <p className={`mt-3 rounded-lg p-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Library ({items.length})</h2>
        {items.length === 0 && <p className="text-sm text-gray-500">No structures yet.</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.id} className={`card overflow-hidden ${it.active ? "" : "opacity-50"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.thumbUrl && <img src={it.thumbUrl} alt="" className="aspect-[3/2] w-full object-cover" />}
              <div className="p-3 text-sm">
                <div className="font-semibold">{it.name}</div>
                <div className="text-xs text-gray-500">{it.panelCount} × {it.wp} Wp = {((it.panelCount * it.wp) / 1000).toFixed(2)} kWp · {fmtLen(it.w, "ft")} × {fmtLen(it.d, "ft")}</div>
                <button className="mt-2 text-xs font-semibold text-brand-700" onClick={() => toggle(it)}>{it.active ? "Hide from studio" : "Show in studio"}</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
