// Development seed: team accounts + the demo project.  Usage: npm run db:seed
// (Production servers don't need this — the /setup page creates the admin.)
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createDemoProject } from "@/lib/setup/demo";

const PASSWORD = "evergreen123";

async function main() {
  const hash = await hashPassword(PASSWORD);
  const users = [
    { name: "Admin", email: "admin@evergreen.test", role: "ADMIN" as const },
    { name: "Ananya Sen (Designer)", email: "designer@evergreen.test", role: "DESIGNER" as const },
    { name: "Rahul Ghosh (Designer)", email: "designer2@evergreen.test", role: "DESIGNER" as const },
    { name: "Priya Banerjee (Sales)", email: "sales@evergreen.test", role: "SALES" as const },
  ];
  const created = [];
  for (const u of users) created.push(await db.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash: hash } }));
  for (const u of created.filter((x) => x.role === "DESIGNER")) {
    if (await db.weeklyAvailability.count({ where: { userId: u.id } })) continue;
    await db.weeklyAvailability.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ userId: u.id, weekday, startMinute: 660, endMinute: 1140 })) });
  }
  const p = await createDemoProject(db, created[1].id);
  if (p) console.log(`Demo project ${p.code}: customer link /p/${p.shareToken}`);
  console.log(`Seeded ${created.length} users. Password for all: ${PASSWORD}`);
}

main().finally(() => db.$disconnect());
