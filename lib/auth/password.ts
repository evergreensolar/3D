import bcrypt from "bcryptjs";
export const hashPassword = (p: string) => bcrypt.hash(p, 11);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);
