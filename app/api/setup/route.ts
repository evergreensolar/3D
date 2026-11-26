import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isConfigured, saveConfig } from "@/lib/config";
import { runMigrations } from "@/lib/setup/migrate";
import { hashPassword } from "@/lib/auth/password";
import { createDemoProject } from "@/lib/setup/demo";
import { startTeamSession } from "@/lib/auth/session";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["test", "install"]),
  host: z.string().trim().min(1, "Enter the database host"),
  port: z.coerce.number().int().min(1).max(65535).default(3306),
  database: z.string().trim().min(1, "Enter the database name"),
  user: z.string().trim().min(1, "Enter the database username"),
  password: z.string().default(""),
  appUrl: z.string().trim().url("Enter the full site address, e.g. https://design.example.com").optional(),
  adminName: z.string().trim().optional(),
  adminEmail: z.string().trim().toLowerCase().optional(),
  adminPassword: z.string().optional(),
  demo: z.boolean().optional(),
});

const dbUrl = (d: { host: string; port: number; database: string; user: string; password: string }) =>
  `mysql://${encodeURIComponent(d.user)}:${encodeURIComponent(d.password)}@${d.host}:${d.port}/${encodeURIComponent(d.database)}`;

function friendly(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/Access denied|Authentication failed/i.test(m)) return "The database username or password is wrong.";
  if (/Unknown database|does not exist/i.test(m)) return "No database with that name. Create it first in Hostinger → Databases.";
  if (/Can't reach|ECONNREFUSED|ENOTFOUND|timed out/i.test(m)) return "Cannot reach the database server. Check the host (usually \"localhost\") and port (3306).";
  return m.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "Unknown error";
}

/** First-run installer: tests the database, creates all tables and the first admin. Disabled once installed. */
export async function POST(req: Request) {
  if (isConfigured()) return NextResponse.json({ error: "The portal is already set up." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const d = parsed.data;
  const url = dbUrl(d);
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$queryRawUnsafe("SELECT 1");
    if (d.action === "test") return NextResponse.json({ ok: true, message: "Connected to the database." });

    if (!d.appUrl) return NextResponse.json({ error: "Enter the site address" }, { status: 400 });
    if (!d.adminName || !d.adminEmail || !/^\S+@\S+\.\S+$/.test(d.adminEmail)) return NextResponse.json({ error: "Enter the admin name and a valid email" }, { status: 400 });
    if (!d.adminPassword || d.adminPassword.length < 8) return NextResponse.json({ error: "Admin password must be at least 8 characters" }, { status: 400 });

    const applied = await runMigrations(client);
    const existing = await client.user.findUnique({ where: { email: d.adminEmail } });
    const admin = existing
      ? await client.user.update({ where: { id: existing.id }, data: { role: "ADMIN", active: true, passwordHash: await hashPassword(d.adminPassword) } })
      : await client.user.create({ data: { name: d.adminName, email: d.adminEmail, role: "ADMIN", passwordHash: await hashPassword(d.adminPassword) } });
    if (!(await client.weeklyAvailability.count({ where: { userId: admin.id } }))) {
      await client.weeklyAvailability.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ userId: admin.id, weekday, startMinute: 660, endMinute: 1140 })) });
    }

    saveConfig({
      DATABASE_URL: url,
      APP_URL: d.appUrl.replace(/\/$/, ""),
      SESSION_SECRET: randomBytes(48).toString("base64url"),
    });
    if (d.demo) await createDemoProject(client, admin.id);
    await startTeamSession(admin);
    return NextResponse.json({ ok: true, migrations: applied });
  } catch (e) {
    return NextResponse.json({ error: friendly(e) }, { status: 400 });
  } finally {
    await client.$disconnect();
  }
}
