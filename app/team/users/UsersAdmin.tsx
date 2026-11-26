"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function UsersAdmin({ users, meId }: { users: { id: string; name: string; email: string; role: string; active: boolean }[]; meId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", phone: "", role: "DESIGNER", password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    const r = await fetch("/api/team/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, phone: f.phone || undefined }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Added ${f.name}. Share the email and password with them.` : j.error ?? "Failed");
    if (r.ok) { setF({ name: "", email: "", phone: "", role: "DESIGNER", password: "" }); router.refresh(); }
  }
  async function patch(id: string, body: object) {
    const r = await fetch(`/api/team/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Saved." : j.error ?? "Failed");
    router.refresh();
  }
  return (
    <div className="space-y-6">
      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="p-3 font-medium">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <select className="input w-auto py-1 text-xs" defaultValue={u.role} disabled={u.id === meId} onChange={(e) => patch(u.id, { role: e.target.value })}>
                    <option value="ADMIN">Admin</option><option value="DESIGNER">Designer</option><option value="SALES">Sales</option>
                  </select>
                </td>
                <td className="p-3">{u.active ? "Active" : "Deactivated"}</td>
                <td className="p-3 text-right">
                  {u.id !== meId && <button className="text-xs text-brand-700" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</button>}
                  <button className="ml-3 text-xs text-gray-600" onClick={() => { const pw = prompt(`New password for ${u.name} (min 8 characters)`); if (pw) patch(u.id, { password: pw }); }}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Add team member</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="Email (login)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="input" placeholder="Mobile (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="DESIGNER">Designer</option><option value="SALES">Sales</option><option value="ADMIN">Admin</option></select>
          <input className="input" placeholder="Password (min 8 characters)" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <button className="btn-primary mt-3" disabled={!f.name || !f.email || f.password.length < 8} onClick={add}>Add member</button>
        <p className="mt-2 text-xs text-gray-500">Designers start with Mon–Sat 11:00–19:00 working hours; they can change them under Availability.</p>
      </section>
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
    </div>
  );
}
