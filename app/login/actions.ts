"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { startTeamSession, endTeamSession } from "@/lib/auth/session";

export async function login(_: unknown, form: FormData) {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const user = await db.user.findUnique({ where: { email } });
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
