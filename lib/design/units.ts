// Feet-and-inches ⇄ metres for site-survey style input. Designs are stored in metres.
export const M_PER_FT = 0.3048;

/** 12.345 m → `40′ 6½″` (ft) or `12.35 m`. */
export function fmtLen(m: number, units: "ft" | "m") {
  if (units === "m") return `${m.toFixed(2)} m`;
  const totalIn = Math.round((m / M_PER_FT) * 12 * 2) / 2; // nearest ½ inch
  let ft = Math.floor(totalIn / 12);
  let inch = totalIn - ft * 12;
  if (inch >= 12) { ft += 1; inch -= 12; }
  const half = inch % 1 ? "½" : "";
  return `${ft}′ ${Math.floor(inch)}${half}″`;
}

export const ftIn = (m: number) => {
  const totalIn = Math.round((m / M_PER_FT) * 12 * 2) / 2;
  return { ft: Math.floor(totalIn / 12), inch: totalIn - Math.floor(totalIn / 12) * 12 };
};

export const fromFtIn = (ft: number, inch: number) => (ft + inch / 12) * M_PER_FT;

/** Accepts "40' 6\"", "40 6", "40.5ft", "12.3m", "12.3" (in the given units). */
export function parseLen(text: string, units: "ft" | "m"): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*m$/);
  if (m) return parseFloat(m[1]);
  const fi = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in|inch|inches)?)?$/);
  if (!fi) return null;
  const a = parseFloat(fi[1]);
  const b = fi[2] ? parseFloat(fi[2]) : 0;
  return units === "m" && !fi[2] ? a : fromFtIn(a, b);
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const NAMES: Record<string, string> = { N: "North", NE: "North-east", E: "East", SE: "South-east", S: "South", SW: "South-west", W: "West", NW: "North-west" };
export const bearingName = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const bearingLong = (deg: number) => NAMES[bearingName(deg)];
