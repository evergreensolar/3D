"use client";
// Embedded Jitsi video call (IFrame API) shown over the 3D design, so the model, comments and the
// call are on one screen. Screen sharing is part of the Jitsi toolbar.
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { JitsiMeetExternalAPI?: new (domain: string, opts: object) => { dispose: () => void; addListener: (e: string, f: () => void) => void } }
}

const loaded = new Map<string, Promise<void>>();
function loadApi(domain: string) {
  if (!loaded.has(domain)) {
    loaded.set(domain, new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `https://${domain}/external_api.js`;
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error("Could not load the video call"));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(domain)!;
}

export function JitsiCall({ domain, room, displayName, joinUrl, onClose, floating }: { domain: string; room: string; displayName: string; joinUrl: string; onClose: () => void; floating?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    let api: { dispose: () => void } | null = null;
    let live = true;
    loadApi(domain).then(() => {
      if (!live || !box.current || !window.JitsiMeetExternalAPI) return;
      const a = new window.JitsiMeetExternalAPI(domain, {
        roomName: room, parentNode: box.current, width: "100%", height: "100%",
        userInfo: { displayName },
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true, startWithVideoMuted: false },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false },
      });
      a.addListener("readyToClose", onClose);
      api = a;
    }).catch((e) => setError(e.message));
    return () => { live = false; api?.dispose(); };
  }, [domain, room, displayName, onClose]);
  return (
    <div className={`${floating ? "fixed" : "absolute"} z-[60] overflow-hidden rounded-xl bg-gray-900 shadow-2xl ring-1 ring-black/20 ${small ? "bottom-3 left-3 h-40 w-56" : floating ? "bottom-3 left-3 h-[380px] w-[520px] max-w-[95vw]" : "inset-x-2 top-2 h-[55%] sm:inset-auto sm:bottom-3 sm:left-3 sm:h-[340px] sm:w-[460px]"}`}>
      <div className="flex items-center justify-between bg-gray-800 px-2 py-1 text-xs text-white">
        <span>🎥 Video call</span>
        <span className="flex gap-3">
          <a className="underline" href={joinUrl} target="_blank" rel="noreferrer">Open in new tab</a>
          <button onClick={() => setSmall(!small)}>{small ? "Enlarge" : "Shrink"}</button>
          <button onClick={onClose}>✕ Leave</button>
        </span>
      </div>
      {error ? <p className="p-3 text-sm text-red-300">{error} — <a className="underline" href={joinUrl} target="_blank" rel="noreferrer">open the call in a new tab</a>.</p> : <div ref={box} className="h-[calc(100%-24px)] w-full" />}
    </div>
  );
}
