"use client";
// On-screen camera pad: hold an arrow to move the view, rotate, zoom, reset; switch whether one
// finger / left mouse drag rotates or moves the view.
import { useRef, useState } from "react";
import type { ViewApi } from "./Scene3D";

export function NavPad({ api, dragMode, setDragMode, measuring, setMeasuring }: {
  api: ViewApi | null;
  dragMode: "rotate" | "move";
  setDragMode: (m: "rotate" | "move") => void;
  measuring: boolean;
  setMeasuring: (on: boolean) => void;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const hold = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); stop(); fn(); timer.current = setInterval(fn, 110); },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
  });
  const [open, setOpen] = useState(true);
  const B = "flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-white/90 text-sm sm:text-base font-semibold text-gray-800 shadow-sm ring-1 ring-black/10 active:bg-brand-50 select-none";
  const disabled = !api;
  return (
    // z-30 keeps the pad above measurement labels drawn on the model
    <div className="absolute right-2 top-16 z-30 flex flex-col items-end gap-1" style={{ touchAction: "none" }}>
      <div className="flex gap-1">
        <button className={`${B} w-auto px-2 text-[11px]`} title={open ? "Hide controls" : "Show controls"} onClick={() => setOpen(!open)}>{open ? "✕" : "🎮"}</button>
        <button className={`${B} w-auto px-2 text-[11px]`} disabled={disabled} title="What one-finger drag does"
          onClick={() => setDragMode(dragMode === "rotate" ? "move" : "rotate")}>
          {dragMode === "rotate" ? "↻ Rotate" : "✋ Move"}
        </button>
        <button className={`${B} ${measuring ? "bg-pink-600 text-white ring-pink-700" : ""}`} title="Measure a distance or height" onClick={() => setMeasuring(!measuring)}>📏</button>
      </div>
      {open && <div className="grid grid-cols-3 gap-1" aria-label="Move the view">
        <button className={B} disabled={disabled} title="Rotate left" {...hold(() => api?.rotate(-6))}>⟲</button>
        <button className={B} disabled={disabled} title="Move up" {...hold(() => api?.pan(0, 1))}>▲</button>
        <button className={B} disabled={disabled} title="Rotate right" {...hold(() => api?.rotate(6))}>⟳</button>
        <button className={B} disabled={disabled} title="Move left" {...hold(() => api?.pan(-1, 0))}>◀</button>
        <button className={`${B} text-xs`} disabled={disabled} title="Reset view" onClick={() => api?.reset()}>⌂</button>
        <button className={B} disabled={disabled} title="Move right" {...hold(() => api?.pan(1, 0))}>▶</button>
        <button className={B} disabled={disabled} title="Zoom out" {...hold(() => api?.zoom(1.12))}>−</button>
        <button className={B} disabled={disabled} title="Move down" {...hold(() => api?.pan(0, -1))}>▼</button>
        <button className={B} disabled={disabled} title="Zoom in" {...hold(() => api?.zoom(0.89))}>+</button>
      </div>}
    </div>
  );
}
