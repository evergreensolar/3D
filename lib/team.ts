import { db } from "@/lib/db";
export const listDesigners = () =>
  db.user.findMany({ where: { role: { in: ["DESIGNER", "ADMIN"] }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
