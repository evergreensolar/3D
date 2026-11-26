"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProcessingInput } from "@/lib/processing/types";

/**
 * Processes a queued version right here in the designer's browser (no server-side Chromium needed).
 * If a server worker or another open tab already took it, this just waits for the result.
 */
export function BrowserProcessor({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [step, setStep] = useState("Starting…");
  const [mine, setMine] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    const log: string[] = [];

    async function go() {
      const c = await fetch(`/api/team/versions/${versionId}/process`, { method: "POST" }).then((r) => r.json()).catch(() => null);
      if (!c?.claimed) {
        // Someone else is processing it — poll until it finishes (and retry the claim if they vanish).
        setStep("Being processed elsewhere…");
        const t = setInterval(async () => {
          const r = await fetch(`/api/team/versions/${versionId}`).then((x) => x.json()).catch(() => null);
          if (r && (r.status === "READY" || r.status === "FAILED")) { clearInterval(t); router.refresh(); }
          else if (r?.status === "QUEUED") { clearInterval(t); started.current = false; go(); }
        }, 4000);
        return;
      }
      setMine(true);
      try {
        const { runProcessing } = await import("@/lib/processing/run");
        const out = await runProcessing(c.input as ProcessingInput, (m) => { log.push(m); if (!cancelled) setStep(m); });
        setStep("Building the PDF report…");
        const fd = new FormData();
        fd.append("meta", JSON.stringify({
          snapshots: out.snapshots.map(({ dataUrl: _d, ...m }) => m), summary: out.summary,
          panelCount: out.panelCount, bbox: out.bbox, log: out.log,
        }));
        for (const s of out.snapshots) fd.append(`snap:${s.name}`, await (await fetch(s.dataUrl)).blob(), `${s.name}.jpg`);
        if (out.glb) fd.append("glb", new Blob([out.glb], { type: "model/gltf-binary" }), "model.glb");
        const r = await fetch(`/api/team/versions/${versionId}/process/complete`, { method: "POST", body: fd });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Upload failed (${r.status})`);
        router.refresh();
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await fetch(`/api/team/versions/${versionId}/process/fail`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ error, log }),
        }).catch(() => {});
        router.refresh();
      }
    }
    go();
    return () => { cancelled = true; };
  }, [versionId, router]);

  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
      <div>
        <b>Processing the design{mine ? " in this browser" : ""}</b> — {step}
        {mine && <div className="text-xs text-blue-700">Please keep this page open (usually under a minute).</div>}
      </div>
    </div>
  );
}
