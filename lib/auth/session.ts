import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isConfigured } from "@/lib/config";
import { signJwt, verifyJwt, TEAM_COOKIE, customerCookieName } from "./jwt";

const TEAM_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const CUSTOMER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

type TeamClaims = { sub: string; role: Role; typ: "team" };
type CustomerClaims = { pid: string; mob: string; typ: "customer" };

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  // Secure when the site is served over https (cookie would be dropped on plain http otherwise).
  secure: env.appUrl.startsWith("https://"),
  path: "/",
  maxAge,
});

export async function startTeamSession(user: { id: string; role: Role }) {
  const token = await signJwt({ sub: user.id, role: user.role, typ: "team" }, TEAM_MAX_AGE);
  (await cookies()).set(TEAM_COOKIE, token, cookieOpts(TEAM_MAX_AGE));
}

export async function endTeamSession() {
  (await cookies()).delete(TEAM_COOKIE);
}

/** Current team member, re-loaded from the DB so deactivation takes effect immediately. */
export async function getTeamUser() {
  if (!isConfigured()) return null;
  const claims = await verifyJwt<TeamClaims>((await cookies()).get(TEAM_COOKIE)?.value);
  if (!claims || claims.typ !== "team") return null;
  const user = await db.user.findUnique({ where: { id: claims.sub } });
  return user && user.active ? user : null;
}

export async function requireTeamUser(roles?: Role[]) {
  await cookies(); // marks the page dynamic before any redirect decision
  if (!isConfigured()) redirect("/setup");
  const user = await getTeamUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/team?error=forbidden");
  return user;
}

export async function startCustomerSession(projectId: string, mobile: string) {
  const token = await signJwt({ pid: projectId, mob: mobile, typ: "customer" }, CUSTOMER_MAX_AGE);
  (await cookies()).set(customerCookieName(projectId), token, cookieOpts(CUSTOMER_MAX_AGE));
}

/** True when the browser holds a verified customer session for this project + mobile. */
export async function hasCustomerSession(project: { id: string; customerMobile: string }) {
  const claims = await verifyJwt<CustomerClaims>((await cookies()).get(customerCookieName(project.id))?.value);
  // Tied to the mobile number: changing the customer's number invalidates old sessions.
  return !!claims && claims.typ === "customer" && claims.pid === project.id && claims.mob === project.customerMobile;
}
