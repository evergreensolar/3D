"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

export function OtpGate({ token, maskedMobile }: { token: string; maskedMobile: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<"start" | "code">("start");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP">("SMS");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send(ch: "SMS" | "WHATSAPP") {
    setBusy(true); setError(null); setChannel(ch);
    try {
      const r = await fetch(`/api/p/${token}/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: ch }) });
      const j = await r.json();
      if (j.ok) {
        setStage("code"); setCooldown(j.resendInSec); setDevCode(j.devCode ?? null); setCode("");
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        setError(j.error); if (j.retryInSec) { setCooldown(j.retryInSec); setStage("code"); }
      }
    } catch { setError("Network problem. Please try again."); }
    setBusy(false);
  }

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/p/${token}/otp/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: value }) });
      const j = await r.json();
      if (j.ok) { router.refresh(); return; }
      setError(j.error);
    } catch { setError("Network problem. Please try again."); }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white p-4">
      <div className="card w-full max-w-sm p-6">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">Your rooftop solar design</h1>
        <p className="mt-1 text-sm text-gray-600">
          See your system in 3D with real sun and shadows. For your privacy, we will send a 6-digit code to your registered mobile <b className="whitespace-nowrap">{maskedMobile}</b>.
        </p>

        {stage === "start" ? (
          <div className="mt-6 space-y-3">
            <button className="btn-primary w-full py-3 text-base" disabled={busy} onClick={() => send("SMS")}>
              {busy ? "Sending…" : "Send code by SMS"}
            </button>
            <button className="btn-secondary w-full" disabled={busy} onClick={() => send("WHATSAPP")}>Send code on WhatsApp</button>
          </div>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <label htmlFor="otp" className="label">Enter the code sent by {channel === "SMS" ? "SMS" : "WhatsApp"}</label>
            <input
              ref={inputRef} id="otp" className="input text-center text-2xl tracking-[0.5em] font-semibold"
              inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="••••••"
              value={code}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) verify(v); }}
            />
            {devCode && <p className="rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-800">Development mode — code: <b>{devCode}</b></p>}
            <button className="btn-primary w-full py-3 text-base" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "View my design"}</button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-brand-700 font-medium disabled:text-gray-400" disabled={cooldown > 0 || busy} onClick={() => send(channel)}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
              <button type="button" className="text-gray-600 disabled:text-gray-400" disabled={cooldown > 0 || busy} onClick={() => send(channel === "SMS" ? "WHATSAPP" : "SMS")}>
                Use {channel === "SMS" ? "WhatsApp" : "SMS"} instead
              </button>
            </div>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <p className="mt-6 text-xs text-gray-400">No app or account needed. Having trouble? Call your Evergreen Solar contact.</p>
      </div>
    </main>
  );
}
