"use client";
import { useEffect } from "react";
import { runProcessing } from "@/lib/processing/run";
import type { ProcessingInput } from "@/lib/processing/types";

declare global {
  interface Window { __EVG_RESULT?: unknown }
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Headless worker variant: runs the shared processor and exposes the result to Playwright. */
export function Processor(props: ProcessingInput) {
  useEffect(() => {
    const log: string[] = [];
    runProcessing(props, (m) => { log.push(m); console.log(m); })
      .then((r) => { window.__EVG_RESULT = { ok: true, ...r, glb: undefined, glbBase64: r.glb ? toBase64(r.glb) : undefined }; })
      .catch((e) => { window.__EVG_RESULT = { ok: false, error: e instanceof Error ? e.message : String(e), log }; });
  }, [props]);
  return <div id="processor" />;
}
