"use client";
import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { parseLatLng } from "@/lib/validation";

export interface ProjectFormValues {
  customerSalutation: string;
  customerName: string;
  customerMobile: string;
  customerEmail: string;
  address: string;
  latitude: string;
  longitude: string;
  northOffsetDeg: string;
  panelMake: string;
  panelModel: string;
  panelWattage: string;
  designerId: string;
}

const EMPTY: ProjectFormValues = {
  customerSalutation: "MR", customerName: "", customerMobile: "", customerEmail: "", address: "",
  latitude: "", longitude: "", northOffsetDeg: "0", panelMake: "", panelModel: "", panelWattage: "", designerId: "",
};

type FieldErrors = Partial<Record<keyof ProjectFormValues | "model", string[]>>;

export function ProjectForm({ mode, projectId, initial, designers }: {
  mode: "create" | "edit";
  projectId?: string;
  initial?: Partial<ProjectFormValues>;
  designers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ProjectFormValues>({ ...EMPTY, ...initial });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [paste, setPaste] = useState("");

  const set = (k: keyof ProjectFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  function onPaste(text: string) {
    setPaste(text);
    const ll = parseLatLng(text);
    if (ll) setV((s) => ({ ...s, latitude: ll.lat.toFixed(6), longitude: ll.lng.toFixed(6) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setErrors({});
    if (mode === "create" && !file) { setErrors({ model: ["Choose the model file exported from SketchUp"] }); return; }
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => fd.append(k, val));
    if (file) fd.append("model", file);

    if (mode === "edit") {
      setProgress(0);
      const r = await fetch(`/api/team/projects/${projectId}`, { method: "PATCH", body: fd });
      const j = await r.json();
      setProgress(null);
      if (!r.ok) { setError(j.error); setErrors(j.fieldErrors ?? {}); return; }
      router.push(`/team/projects/${projectId}`);
      router.refresh();
      return;
    }
    // XHR for upload progress on slow site connections.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/team/projects");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      let j: { id?: string; error?: string; fieldErrors?: FieldErrors } = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && j.id) router.push(`/team/projects/${j.id}`);
      else {
        setError(j.error ?? (xhr.status === 413 ? "The file is larger than the hosting allows. Try exporting the model without hidden layers/high-resolution textures." : `Upload failed (${xhr.status})`));
        setErrors(j.fieldErrors ?? {});
      }
    };
    xhr.onerror = () => { setProgress(null); setError("Network error during upload"); };
    setProgress(0);
    xhr.send(fd);
  }

  const err = (k: keyof FieldErrors) => errors[k]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[k]![0]}</p>;

  return (
    <ErrorsCtx.Provider value={errors}>
    <form onSubmit={submit} className="space-y-6">
      <section className="card p-4 sm:p-6">
        <h2 className="font-semibold">Customer</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <Field k="customerSalutation" label="Address as" className="sm:col-span-1">
            <select id="customerSalutation" className="input" value={v.customerSalutation} onChange={set("customerSalutation")}>
              <option value="MR">Mr.</option><option value="MRS">Mrs.</option><option value="MS">Ms.</option><option value="DR">Dr.</option>
              <option value="NONE">Sir/Ma&apos;am</option>
            </select>
          </Field>
          <Field k="customerName" label="Full name" className="sm:col-span-3">
            <input id="customerName" className="input" value={v.customerName} onChange={set("customerName")} required autoComplete="off" />
          </Field>
          <Field k="customerMobile" label="Mobile (for OTP)" className="sm:col-span-2">
            <input id="customerMobile" className="input" inputMode="tel" placeholder="98300 12345" value={v.customerMobile} onChange={set("customerMobile")} required />
          </Field>
          <Field k="customerEmail" label="Email (optional)" className="sm:col-span-3">
            <input id="customerEmail" type="email" className="input" value={v.customerEmail} onChange={set("customerEmail")} />
          </Field>
          <Field k="address" label="Site address" className="sm:col-span-6">
            <textarea id="address" rows={2} className="input" value={v.address} onChange={set("address")} required />
          </Field>
        </div>
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="font-semibold">Site location & orientation</h2>
        <p className="mt-1 text-xs text-gray-500">Paste a Google Maps link or &quot;22.5726, 88.3639&quot; to fill the coordinates.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <input className="input" placeholder="Paste Google Maps link or coordinates" value={paste} onChange={(e) => onPaste(e.target.value)} />
          </div>
          <Field k="latitude" label="Latitude" className="sm:col-span-2">
            <input id="latitude" className="input" inputMode="decimal" value={v.latitude} onChange={set("latitude")} required />
          </Field>
          <Field k="longitude" label="Longitude" className="sm:col-span-2">
            <input id="longitude" className="input" inputMode="decimal" value={v.longitude} onChange={set("longitude")} required />
          </Field>
          <Field k="northOffsetDeg" label="Model north rotation (°)" className="sm:col-span-2">
            <input id="northOffsetDeg" className="input" inputMode="decimal" value={v.northOffsetDeg} onChange={set("northOffsetDeg")} />
          </Field>
          <p className="text-xs text-gray-500 sm:col-span-6">
            North rotation: the compass bearing that SketchUp&apos;s green axis points to. Keep 0 if the model is drawn with the green axis pointing true north
            (SketchUp → Window → Model Info → Geo-location → north angle).
          </p>
        </div>
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="font-semibold">Panels</h2>
        <p className="mt-1 text-xs text-gray-500">
          Only the panel rating is needed. The number of panels, system size (kW), tilt, direction and structure height
          are measured from the SketchUp model automatically.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-6">
          <Field k="panelWattage" label="Panel rating (Wp)" className="sm:col-span-2">
            <input id="panelWattage" className="input" inputMode="numeric" placeholder="550" value={v.panelWattage} onChange={set("panelWattage")} required />
          </Field>
          <Field k="panelMake" label="Make (optional)" className="sm:col-span-2">
            <input id="panelMake" className="input" placeholder="Waaree / Adani / Vikram / Tata" value={v.panelMake} onChange={set("panelMake")} />
          </Field>
          <Field k="panelModel" label="Model (optional)" className="sm:col-span-2">
            <input id="panelModel" className="input" value={v.panelModel} onChange={set("panelModel")} />
          </Field>
          {designers.length > 0 && (
            <Field k="designerId" label="Designer" className="sm:col-span-3">
              <select id="designerId" className="input" value={v.designerId} onChange={set("designerId")}>
                <option value="">Me / unassigned</option>
                {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </section>

      {mode === "create" && (
        <section className="card p-4 sm:p-6">
          <h2 className="font-semibold">SketchUp model</h2>
          <p className="mt-1 text-xs text-gray-500">
            Export <b>.glb</b> (preferred) or <b>.dae</b> (COLLADA). For .dae with textures, zip the .dae together with its texture folder.
            Name each panel component &quot;Solar Panel …&quot; so shading can be calculated per panel.
          </p>
          <input
            type="file" accept=".glb,.dae,.zip,model/gltf-binary" className="mt-4 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-700"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="mt-2 text-xs text-gray-600">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
          {err("model")}
        </section>
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={progress !== null}>
          {progress !== null ? (mode === "create" ? `Uploading ${progress}%` : "Saving…") : mode === "create" ? "Upload & process" : "Save changes"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
    </ErrorsCtx.Provider>
  );
}

const ErrorsCtx = createContext<FieldErrors>({});

// Declared at module level so inputs keep focus while typing.
function Field({ k, label, children, className = "" }: { k: keyof FieldErrors; label: string; children: React.ReactNode; className?: string }) {
  const e = useContext(ErrorsCtx)[k]?.[0];
  return (
    <div className={className}>
      <label className="label" htmlFor={k}>{label}</label>
      {children}
      {e && <p className="mt-1 text-xs text-red-600">{e}</p>}
    </div>
  );
}
