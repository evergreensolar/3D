// Video meeting provider, behind an interface so a self-hosted Jitsi (or JaaS / 8x8) can replace
// the public server later by configuration only.
//   VIDEO_PROVIDER = jitsi (default) | jaas
//   JITSI_DOMAIN   = meet.jit.si (default) or your own server, e.g. meet.evergreensolar.in
//   JAAS_APP_ID    = vpaas-magic-cookie-… (when VIDEO_PROVIDER=jaas, domain 8x8.vc)
import { randomBytes } from "node:crypto";

export interface VideoProvider {
  name: string;
  domain: string;
  /** Room name for the IFrame API (JaaS needs the app id prefix). */
  roomForApi(room: string): string;
  /** Direct link that opens the room in a browser tab / the Jitsi app. */
  joinUrl(room: string): string;
}

export function videoProvider(): VideoProvider {
  if (process.env.VIDEO_PROVIDER === "jaas" && process.env.JAAS_APP_ID) {
    const app = process.env.JAAS_APP_ID;
    return { name: "jaas", domain: "8x8.vc", roomForApi: (r) => `${app}/${r}`, joinUrl: (r) => `https://8x8.vc/${app}/${r}` };
  }
  const domain = process.env.JITSI_DOMAIN || "meet.jit.si";
  return { name: domain === "meet.jit.si" ? "jitsi-public" : "jitsi-self-hosted", domain, roomForApi: (r) => r, joinUrl: (r) => `https://${domain}/${r}` };
}

/** Unguessable room name per meeting. */
export const newRoomName = (projectCode: string) => `EvergreenSolar-${projectCode}-${randomBytes(6).toString("hex")}`;
