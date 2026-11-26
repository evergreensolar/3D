// Applies prisma/migrations/*/migration.sql at runtime — no `prisma` CLI or shell needed on the host.
// Records each migration in `_prisma_migrations` exactly like `prisma migrate deploy`, so both stay compatible.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const DIR = path.join(process.cwd(), "prisma", "migrations");

export async function runMigrations(client: PrismaClient): Promise<string[]> {
  if (!existsSync(DIR)) throw new Error(`Migrations folder not found at ${DIR}`);
  await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    finished_at DATETIME(3),
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at DATETIME(3),
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const done = new Set(
    (await client.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    )).map((r) => r.migration_name),
  );
  const applied: string[] = [];
  const names = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(DIR, name, "migration.sql"), "utf8");
    const id = randomUUID();
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.$executeRawUnsafe("INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at) VALUES (?, ?, ?, NOW(3))", id, checksum, name);
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((st) => st.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const st of statements) await client.$executeRawUnsafe(st);
    await client.$executeRawUnsafe(
      "UPDATE _prisma_migrations SET finished_at = NOW(3), applied_steps_count = ? WHERE id = ?", statements.length, id,
    );
    applied.push(name);
  }
  return applied;
}
