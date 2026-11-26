"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { startTeamSession, endTeamSession } from "@/lib/auth/session";

export async function login(_: unknown, form: FormData) {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  let user = await db.user.findUnique({ where: { email } });
  // First run on a fresh server (no seed): ADMIN_EMAIL / ADMIN_PASSWORD create the first admin.
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "";
  if (!user && adminEmail && adminPass.length >= 8 && email === adminEmail && password === adminPass && (await db.user.count()) === 0) {
    user = await db.user.create({ data: { name: "Admin", email, role: "ADMIN", passwordHash: await hashPassword(password) } });
  }
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong email or password" };
  }
  await startTeamSession(user);
  const next = String(form.get("next") || "/team");
  redirect(next.startsWith("/team") ? next : "/team");
}

export async function logout() {
  await endTeamSession();
  redirect("/login");
}
