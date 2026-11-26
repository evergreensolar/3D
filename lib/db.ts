import { PrismaClient } from "@prisma/client";
import { applyConfig } from "@/lib/config";

// Created lazily: the database URL may only become known after the first-run setup.
const g = globalThis as unknown as { prisma?: PrismaClient; prismaUrl?: string };

export function getDb(): PrismaClient {
  applyConfig();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured yet — open /setup");
  if (!g.prisma || g.prismaUrl !== url) {
    void g.prisma?.$disconnect();
    g.prisma = new PrismaClient({ datasourceUrl: url });
    g.prismaUrl = url;
  }
  return g.prisma;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = getDb();
    const v = Reflect.get(client, prop, client);
    return typeof v === "function" ? v.bind(client) : v;
  },
});
