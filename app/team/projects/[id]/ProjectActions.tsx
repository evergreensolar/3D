"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={url} className="input min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button
        className="btn-secondary shrink-0"
        onClick={async () => { await navigator.clipboard.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      >{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function SendToCustomer({ projectId, hasEmail, disabled }: { projectId: string; hasEmail: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [channels, setChannels] = useState<string[]>(["WHATSAPP", "SMS", ...(hasEmail ? ["EMAIL"] : [])]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (c: string) => setChannels((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  async function send() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/team/projects/${projectId}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channels }) });
    const j = await r.json();
    setBusy(false);
    if (j.results) {
      const parts = (j.results as { channel: string; ok: boolean; error?: string }[]).map((x) => `${x.channel.toLowerCase()}: ${x.ok ? "sent" : `failed (${x.error})`}`);
      setMsg({ ok: j.ok, text: parts.join(" · ") });
    } else setMsg({ ok: false, text: j.error });
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 text-sm">
        {[["WHATSAPP", "WhatsApp (with PDF)"], ["SMS", "SMS (link)"], ["EMAIL", "Email (PDF attached)"]].map(([c, label]) => (
          <label key={c} className={`flex items-center gap-2 ${c === "EMAIL" && !hasEmail ? "opacity-40" : ""}`}>
            <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={c === "EMAIL" && !hasEmail} checked={channels.includes(c)} onChange={() => toggle(c)} />
            {label}
          </label>
        ))}
      </div>
      <button className="btn-primary mt-3 w-full" disabled={disabled || busy || !channels.length} onClick={send}>
        {busy ? "Sending…" : "Send design to customer"}
      </button>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}

export function Reprocess({ projectId, versionId, label = "Re-process" }: { projectId: string; versionId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn-secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch(`/api/team/projects/${projectId}/reprocess`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId }) });
      router.refresh();
      setBusy(false);
    }}>{busy ? "Queued…" : label}</button>
  );
}

/** Polls a processing version and refreshes the page when it finishes. */
export function ProcessingPoller({ versionId }: { versionId: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/team/versions/${versionId}`).then((x) => x.json()).catch(() => null);
      if (r && (r.status === "READY" || r.status === "FAILED")) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [versionId, router]);
  return null;
}
