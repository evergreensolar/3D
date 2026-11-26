"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Upload a revised SketchUp export as the next version (chunked, like the first upload). */
export function UploadVersion({ projectId, label = "Upload revised model" }: { projectId: string; label?: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!file) return;
    setError(null);
    try {
      setProgress("Uploading 0%");
      const start = await fetch("/api/team/uploads", { method: "POST" }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? "Could not start upload");
      const n = Math.ceil(file.size / start.chunkBytes);
      for (let i = 0; i < n; i++) {
        let ok = false;
        for (let a = 0; a < 4 && !ok; a++) {
          const r = await fetch(`/api/team/uploads/${start.id}?index=${i}`, { method: "PUT", body: file.slice(i * start.chunkBytes, (i + 1) * start.chunkBytes) }).catch(() => null);
          ok = !!r?.ok;
          if (!ok) await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
        }
        if (!ok) throw new Error("Upload interrupted — please try again");
        setProgress(`Uploading ${Math.round(((i + 1) / n) * 100)}%`);
      }
      setProgress("Saving…");
      const r = await fetch(`/api/team/projects/${projectId}/versions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: start.id, chunks: n, filename: file.name, changeNotes: notes || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
      setFile(null); setNotes(""); setProgress(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2">
      <input type="file" accept=".glb,.dae,.zip" className="block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:font-semibold file:text-brand-700"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {file && <input className="input text-xs" placeholder="What changed? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />}
      <button className="btn-secondary w-full" disabled={!file || !!progress} onClick={send}>{progress ?? label}</button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
