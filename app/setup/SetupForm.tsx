"use client";
import { useState } from "react";

export function SetupForm({ defaultAppUrl }: { defaultAppUrl: string }) {
  const [f, setF] = useState({
    host: "localhost", port: "3306", database: "", user: "", password: "",
    appUrl: defaultAppUrl, adminName: "", adminEmail: "", adminPassword: "", demo: true,
  });
  const [busy, setBusy] = useState<"test" | "install" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function call(action: "test" | "install") {
    setBusy(action); setMsg(null);
    try {
      const r = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, action }) });
      const j = await r.json();
      if (!r.ok) setMsg({ ok: false, text: j.error });
      else if (action === "test") setMsg({ ok: true, text: j.message });
      else { setMsg({ ok: true, text: "All set! Opening the portal…" }); window.location.href = "/team"; return; }
    } catch { setMsg({ ok: false, text: "Network error — please try again." }); }
    setBusy(null);
  }

  const input = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <input id={k} className="input" value={f[k] as string} onChange={set(k)} autoComplete="off" {...props} />
    </div>
  );

  return (
    <form className="mt-6 space-y-6" onSubmit={(e) => { e.preventDefault(); call("install"); }}>
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">1. Database (MySQL / MariaDB)</h2>
          <p className="mt-1 text-xs text-gray-500">
            In Hostinger: hPanel → Websites → Databases → Management. Create a database, then copy its name, username and password here.
            The host is usually <b>localhost</b>.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">{input("host", "Host")}</div>
          {input("port", "Port", { inputMode: "numeric" })}
        </div>
        {input("database", "Database name", { placeholder: "u123456789_evergreen", required: true })}
        {input("user", "Database username", { placeholder: "u123456789_admin", required: true })}
        {input("password", "Database password", { type: "password" })}
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => call("test")}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">2. Site address</h2>
        {input("appUrl", "Address customers will open (used in links, QR codes and messages)", { required: true })}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">3. Your admin login</h2>
        {input("adminName", "Your name", { required: true })}
        {input("adminEmail", "Email", { type: "email", required: true })}
        {input("adminPassword", "Password (min 8 characters)", { type: "password", minLength: 8, required: true })}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.demo} onChange={set("demo")} />
          Add a demo project with a sample rooftop model
        </label>
      </section>

      {msg && <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role="alert">{msg.text}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={!!busy}>
        {busy === "install" ? "Creating tables and admin…" : "Install"}
      </button>
    </form>
  );
}
