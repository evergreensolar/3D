import { db } from "@/lib/db";
import { hasCustomerSession } from "@/lib/auth/session";
import { isConfigured } from "@/lib/config";

/** The project behind a customer link, only when this browser has verified the OTP. */
export async function customerProject(token: string) {
  if (!isConfigured()) return null;
  const project = await db.project.findUnique({ where: { shareToken: token }, include: { designer: true } });
  if (!project || !(await hasCustomerSession(project))) return null;
  return project;
}
