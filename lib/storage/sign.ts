// HMAC-signed URLs for the local storage driver (and for worker render pages).
import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET missing");
  return s;
};

export function sign(value: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${value}\n${exp}`).digest("base64url");
}

export function verify(value: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(value, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function signedQuery(value: string, ttlSec: number, extra: Record<string, string> = {}) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return new URLSearchParams({ ...extra, exp: String(exp), sig: sign(value + (extra.dl ?? ""), exp) }).toString();
}
