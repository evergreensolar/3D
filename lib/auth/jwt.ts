// Edge-safe JWT helpers (used by middleware and server code).
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export async function signJwt(payload: JWTPayload, maxAgeSec: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSec)
    .sign(key());
}

export async function verifyJwt<T extends JWTPayload>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as T;
  } catch {
    return null;
  }
}

export const TEAM_COOKIE = "evg_t";
export const customerCookieName = (projectId: string) => `evg_c_${projectId}`;
