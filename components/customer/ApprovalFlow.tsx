"use client";
// "Approve design": front camera + on-screen consent script, recorded with MediaRecorder, then
// confirmed with a mobile OTP. The video is uploaded in pieces and stored with a SHA-256 hash.
import { useEffect, useRef, useState } from "react";

type Step = "intro" | "camera" | "recording" | "review" | "otp" | "sending" | "done";
const MAX_SECONDS = 90;

function pickMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export function ApprovalFlow({ token, versionId, versionNumber, consent, onClose, onDone }: {
  token: string; versionId: string; versionNumber: number; consent: string; onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { stopCamera(); if (timer.current) clearInterval(timer.current); }, []);

  async function startCamera() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
      setStep("camera");
      setTimeout(() => { if (live.current) { live.current.srcObject = stream.current; live.current.play().catch(() => {}); } }, 50);
    } catch {
      setError("Camera or microphone permission was refused. Please allow them in your browser settings and try again.");
    }
  }

  function startRecording() {
    if (!stream.current) return;
    const mime = pickMime();
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 900_000 } : undefined);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => { setBlob(new Blob(chunks, { type: r.mimeType || mime || "video/webm" })); setStep("review"); stopCamera(); };
    r.start(1000);
    rec.current = r;
    setSeconds(0);
    setStep("recording");
    timer.current = setInterval(() => setSeconds((s) => {
      if (s + 1 >= MAX_SECONDS) stopRecording();
      return s + 1;
    }), 1000);
  }
  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  }

  async function sendOtp() {
    setError(null);
    const r = await fetch(`/api/p/${token}/approval/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "SMS" }) });
    const j = await r.json();
    if (j.ok) { setOtpSent(true); setDevCode(j.devCode ?? null); } else setError(j.error);
  }

  async function submit() {
    if (!blob || code.length !== 6) return;
    setStep("sending"); setError(null);
    try {
      setProgress("Uploading the video…");
      const start = await fetch(`/api/p/${token}/uploads`, { method: "POST" }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? "Upload could not start");
      const n = Math.ceil(blob.size / start.chunkBytes);
      for (let i = 0; i < n; i++) {
        let ok = false;
        for (let a = 0; a < 4 && !ok; a++) {
          const r = await fetch(`/api/p/${token}/uploads/${start.id}?index=${i}`, { method: "PUT", body: blob.slice(i * start.chunkBytes, (i + 1) * start.chunkBytes) }).catch(() => null);
          ok = !!r?.ok;
          if (!ok) await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
        }
        if (!ok) throw new Error("The upload was interrupted. Please check your connection and try again.");
        setProgress(`Uploading the video… ${Math.round(((i + 1) / n) * 100)}%`);
      }
      setProgress("Saving your approval…");
      const device = {
        userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language,
        screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const r = await fetch(`/api/p/${token}/approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId, uploadId: start.id, chunks: n, code, device }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Approval failed");
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("otp");
      setCode("");
      setOtpSent(false);
    }
  }

  const reviewUrl = blob ? URL.createObjectURL(blob) : null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal>
      <div className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Approve design Version {versionNumber}</h2>
          {step !== "sending" && <button className="text-gray-500" onClick={() => { stopRecording(); stopCamera(); step === "done" ? onDone() : onClose(); }}>✕</button>}
        </div>

        {step === "intro" && (
          <div className="mt-3 space-y-3 text-sm">
            <p>To approve, please record a short video of yourself reading this line aloud. Then confirm with a code sent to your mobile.</p>
            <blockquote className="rounded-xl bg-brand-50 p-3 text-base font-medium">“{consent}”</blockquote>
            <p className="text-xs text-gray-500">The video is stored securely with your name, mobile number, design version, date and time (IST) and device details as your approval record. The design is then locked and installed exactly as shown.</p>
            <button className="btn-primary w-full py-3" onClick={startCamera}>Open front camera</button>
          </div>
        )}

        {(step === "camera" || step === "recording") && (
          <div className="mt-3 space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={live} muted playsInline className="aspect-[4/3] w-full -scale-x-100 object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-base font-semibold leading-snug text-white">“{consent}”</div>
              {step === "recording" && <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">● REC {seconds}s</div>}
            </div>
            {step === "camera" ? (
              <button className="btn-primary w-full py-3" onClick={startRecording}>● Start recording, then read the line aloud</button>
            ) : (
              <button className="btn w-full bg-red-600 py-3 text-white" onClick={stopRecording} disabled={seconds < 3}>■ Stop recording</button>
            )}
          </div>
        )}

        {step === "review" && reviewUrl && (
          <div className="mt-3 space-y-3">
            <video src={reviewUrl} controls playsInline className="aspect-[4/3] w-full rounded-xl bg-black" />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => { setBlob(null); startCamera(); }}>Record again</button>
              <button className="btn-primary flex-1" onClick={() => { setStep("otp"); sendOtp(); }}>Looks good — continue</button>
            </div>
          </div>
        )}

        {step === "otp" && (
          <div className="mt-3 space-y-3 text-sm">
            <p>{otpSent ? "Enter the 6-digit code we sent to your registered mobile to confirm your approval." : "Sending a code to your registered mobile…"}</p>
            <input className="input text-center text-2xl font-semibold tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            {devCode && <p className="rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-800">Development mode — code: <b>{devCode}</b></p>}
            <button className="btn-primary w-full py-3" disabled={code.length !== 6} onClick={submit}>✅ Confirm approval</button>
            <button className="w-full text-xs text-brand-700" onClick={sendOtp}>Send the code again</button>
          </div>
        )}

        {step === "sending" && <p className="mt-6 text-center text-sm text-gray-700">{progress}</p>}

        {step === "done" && (
          <div className="mt-4 space-y-3 text-center">
            <div className="text-5xl">✅</div>
            <p className="text-base font-semibold">Thank you! Design Version {versionNumber} is approved.</p>
            <p className="text-sm text-gray-600">Our team will contact you with the next steps.</p>
            <button className="btn-primary w-full" onClick={onDone}>Close</button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
