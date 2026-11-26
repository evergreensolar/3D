import { z } from "zod";

/** Normalises Indian mobile numbers to E.164 (+91XXXXXXXXXX). Accepts other +CC numbers as-is. */
export function normaliseMobile(input: string): string | null {
  const s = input.replace(/[\s\-()]/g, "");
  if (/^\+\d{10,15}$/.test(s)) return /^\+91/.test(s) && !/^\+91[6-9]\d{9}$/.test(s) ? null : s;
  const digits = s.replace(/^0+/, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export function maskMobile(e164: string) {
  const d = e164.replace(/^\+91/, "");
  return `${e164.startsWith("+91") ? "+91 " : ""}${d.slice(0, 2)}••••••${d.slice(-2)}`;
}

/** Parses "22.5726, 88.3639", "22.5726° N, 88.3639° E" or a Google Maps URL (…@22.57,88.36,… / ?q=22.57,88.36). */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const s = decodeURIComponent(input.trim());
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  let lat: number, lng: number;
  if (at) {
    lat = parseFloat(at[1]); lng = parseFloat(at[2]);
  } else {
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?/i);
    if (!m) return null;
    lat = parseFloat(m[1]) * (m[2]?.toUpperCase() === "S" ? -1 : 1);
    lng = parseFloat(m[3]) * (m[4]?.toUpperCase() === "W" ? -1 : 1);
  }
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return { lat, lng };
}

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const projectSchema = z.object({
  customerSalutation: z.enum(["MR", "MRS", "MS", "DR", "NONE"]),
  customerName: z.string().trim().min(2, "Enter the customer's name").max(120),
  customerMobile: z.string().transform((v, ctx) => {
    const n = normaliseMobile(v);
    if (!n) ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
    return n ?? "";
  }),
  customerEmail: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  address: z.string().trim().min(5, "Enter the site address").max(500),
  latitude: num(-90, 90),
  longitude: num(-180, 180),
  northOffsetDeg: num(-360, 360).default(0),
  // Panel count, system size and structure are measured from the SketchUp model.
  panelWattage: z.coerce.number({ message: "Enter the panel rating in Wp" }).int("Whole number, e.g. 550").min(100, "Between 100 and 1000 Wp").max(1000, "Between 100 and 1000 Wp"),
  panelMake: z.string().trim().max(80).optional(),
  panelModel: z.string().trim().max(80).optional(),
  designerId: z.string().optional().or(z.literal("")),
});
export type ProjectInput = z.infer<typeof projectSchema>;
