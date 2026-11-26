// Generation estimate for a rooftop system, per panel, combining:
//  • monthly solar resource for West Bengal (NASA POWER long-term averages, interpolated by latitude
//    between Kolkata and Siliguri),
//  • hourly sun position (suncalc) and a standard irradiance model (constant daily clearness,
//    Collares-Pereira/Liu-Jordan diffuse fraction, isotropic sky transposition onto each panel),
//  • the ray-traced shading of each panel at each half hour (beam blocked → only diffuse light),
//  • module temperature, system losses, and soiling with vs without regular cleaning.
// Results are stored per kWp, so changing the panel wattage just rescales them.
// Isomorphic (no three.js / DOM).
import { sunState, SIM_YEAR } from "@/lib/scene/sun";
import { istDate } from "@/lib/time";

const D2R = Math.PI / 180;

/** Monthly mean daily global horizontal irradiation (kWh/m²/day) and daytime air temperature (°C). */
const CLIMATE = {
  south: { lat: 22.57, ghi: [4.45, 5.15, 5.85, 6.25, 6.05, 4.75, 4.3, 4.4, 4.3, 4.6, 4.5, 4.2], temp: [22, 26, 31, 33, 33, 31, 30, 30, 30, 29, 26, 23] }, // Kolkata
  north: { lat: 26.72, ghi: [4.0, 4.7, 5.4, 5.6, 5.3, 4.4, 4.0, 4.2, 3.9, 4.4, 4.2, 3.9], temp: [18, 21, 25, 28, 29, 29, 29, 29, 28, 26, 23, 19] }, // Siliguri
};

export function siteClimate(lat: number) {
  const t = Math.min(1, Math.max(0, (lat - CLIMATE.south.lat) / (CLIMATE.north.lat - CLIMATE.south.lat)));
  const mix = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] - x) * t);
  return { ghi: mix(CLIMATE.south.ghi, CLIMATE.north.ghi), temp: mix(CLIMATE.south.temp, CLIMATE.north.temp) };
}

export interface EnergyAssumptions {
  /** Soiling loss (%) per month when panels are NOT cleaned (dust builds up in the dry months; monsoon rain washes it). */
  soilingDirtyPct: number[];
  /** Soiling loss (%) with regular cleaning (every 1–2 weeks). */
  soilingCleanPct: number;
  /** Power temperature coefficient, %/°C (mono PERC ≈ −0.37). */
  tempCoeffPctPerC: number;
  /** Cell temperature rise above ambient at 1000 W/m² (°C). */
  cellRiseC: number;
  /** Other losses: mismatch, DC/AC cabling, first-year degradation, availability (%). */
  otherLossPct: number;
  /** Inverter efficiency (%). */
  inverterEffPct: number;
  /** Ground reflectance. */
  albedo: number;
}

export const DEFAULT_ASSUMPTIONS: EnergyAssumptions = {
  soilingDirtyPct: [10, 12, 14, 15, 12, 5, 3, 3, 4, 6, 8, 10],
  soilingCleanPct: 2,
  tempCoeffPctPerC: -0.37,
  cellRiseC: 30,
  otherLossPct: 10,
  inverterEffPct: 97,
  albedo: 0.2,
};

export interface PanelGeom {
  /** Upward unit normal of the panel surface, model coordinates. */
  normal: [number, number, number];
}

export interface EnergyEstimate {
  /** Half-hour time steps (IST hours) used for the daily profile. */
  hours: number[];
  /** Per kWp. */
  months: {
    month: number;
    days: number;
    clean: number; // kWh/kWp in the month, cleaned regularly
    dirty: number; // kWh/kWp, never cleaned
    noShade: number; // kWh/kWp, cleaned, if nothing cast shade
    poa: number; // kWh/m² on the panels (average panel)
  }[];
  /** profile[month-1][i] = average AC power, kW per kWp (cleaned), at hours[i] on a typical day. */
  profile: number[][];
  annual: { clean: number; dirty: number; noShade: number };
  /** Annual performance ratio (cleaned) vs. irradiation on the panels. */
  performanceRatio: number;
  assumptions: EnergyAssumptions;
  method: string;
}

/** Daily-mean diffuse fraction from monthly clearness index (Collares-Pereira & Rabl style fit). */
function diffuseFraction(kt: number) {
  const k = Math.min(0.8, Math.max(0.3, kt));
  return Math.min(0.95, Math.max(0.1, 1.391 - 3.56 * k + 4.189 * k * k - 2.137 * k * k * k));
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const STEP_H = 0.5;
export const PROFILE_HOURS = Array.from({ length: 29 }, (_, i) => 5 + i * STEP_H); // 5:00 … 19:00

export interface IrradianceAt {
  up: boolean;
  sun: [number, number, number];
  dni: number; // W/m²
  dhi: number;
  ghi: number;
  tempC: number;
}

const DOY0 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const factorCache = new Map<string, { kt: number; fd: number; g0: number; temp: number }>();

/** Month-level clearness, diffuse fraction and temperature for the site (cached). */
function monthFactors(lat: number, lng: number, month: number) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${month}`;
  const hit = factorCache.get(key);
  if (hit) return hit;
  const clim = siteClimate(lat);
  const g0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * (DOY0[month - 1] + 21)) / 365));
  let h0 = 0; // daily extraterrestrial horizontal irradiation, kWh/m² (5-min integration)
  for (let m = 0; m < 24 * 60; m += 5) {
    const st = sunState(istDate(SIM_YEAR, month, 21, m / 60), lat, lng, 0);
    if (st.up) h0 += (g0 * Math.sin(st.altitudeDeg * D2R) * 5) / 60 / 1000;
  }
  const kt = clim.ghi[month - 1] / h0;
  const f = { kt, fd: diffuseFraction(kt), g0, temp: clim.temp[month - 1] };
  factorCache.set(key, f);
  return f;
}

/** Monthly-average irradiance components at an instant (any day of `month`). */
export function irradianceAt(lat: number, lng: number, northOffsetDeg: number, date: Date, month: number): IrradianceAt {
  const f = monthFactors(lat, lng, month);
  const st = sunState(date, lat, lng, northOffsetDeg);
  const sinAlt = Math.sin(st.altitudeDeg * D2R);
  if (!st.up || sinAlt <= 0.02) return { up: false, sun: st.direction, dni: 0, dhi: 0, ghi: 0, tempC: f.temp };
  const ghi = f.kt * f.g0 * sinAlt; // constant clearness through the day
  const dhi = f.fd * ghi;
  return { up: true, sun: st.direction, dni: (ghi - dhi) / sinAlt, dhi, ghi, tempC: f.temp };
}

/** The representative day (21st) at each half hour. */
export function irradianceTable(lat: number, lng: number, northOffsetDeg: number, month: number) {
  return PROFILE_HOURS.map((h) => irradianceAt(lat, lng, northOffsetDeg, istDate(SIM_YEAR, month, 21, h), month));
}

/** Estimated AC output (kW) of the whole system at an instant, given each panel's shaded fraction. */
export function instantOutputKw(o: {
  lat: number; lng: number; northOffsetDeg: number; date: Date; month: number;
  normals: [number, number, number][]; fractions: ArrayLike<number>; kwp: number; cleaned?: boolean;
  assumptions?: EnergyAssumptions;
}) {
  const a = o.assumptions ?? DEFAULT_ASSUMPTIONS;
  const irr = irradianceAt(o.lat, o.lng, o.northOffsetDeg, o.date, o.month);
  if (!irr.up || !o.normals.length) return 0;
  const soil = o.cleaned === false ? a.soilingDirtyPct[o.month - 1] : a.soilingCleanPct;
  let sum = 0;
  o.normals.forEach((n, k) => { sum += acPerKwp(panelPoa(n, irr, o.fractions[k] ?? 0, a.albedo), irr.tempC, soil, a); });
  return (sum / o.normals.length) * o.kwp;
}

/** Irradiance on one panel (W/m²), beam reduced by its shaded fraction. */
export function panelPoa(n: [number, number, number], irr: IrradianceAt, shadedFraction: number, albedo: number) {
  if (!irr.up) return 0;
  const cosI = Math.max(0, n[0] * irr.sun[0] + n[1] * irr.sun[1] + n[2] * irr.sun[2]);
  const tilt = Math.max(-1, Math.min(1, n[1]));
  return irr.dni * cosI * (1 - shadedFraction) + irr.dhi * (1 + tilt) / 2 + irr.ghi * albedo * (1 - tilt) / 2;
}

/** AC kW per kWp for a given plane-of-array irradiance, ambient temperature and soiling loss. */
export function acPerKwp(poa: number, tempC: number, soilingPct: number, a: EnergyAssumptions) {
  if (poa <= 0) return 0;
  const cell = tempC + (a.cellRiseC * poa) / 1000;
  const temp = 1 + (a.tempCoeffPctPerC / 100) * (cell - 25);
  return (poa / 1000) * temp * (1 - soilingPct / 100) * (1 - a.otherLossPct / 100) * (a.inverterEffPct / 100);
}

/**
 * Full-year estimate. `shadeAt(month, hour)` returns each panel's shaded fraction (0..1), in the same
 * order as `panels`. All panels are assumed to have the same rating.
 */
export function estimateEnergy(o: {
  lat: number;
  lng: number;
  northOffsetDeg: number;
  panels: PanelGeom[];
  shadeAt: (month: number, hour: number) => ArrayLike<number>;
  assumptions?: EnergyAssumptions;
}): EnergyEstimate {
  const a = o.assumptions ?? DEFAULT_ASSUMPTIONS;
  const n = Math.max(1, o.panels.length);
  const months: EnergyEstimate["months"] = [];
  const profile: number[][] = [];
  let poaYear = 0;
  for (let month = 1; month <= 12; month++) {
    const table = irradianceTable(o.lat, o.lng, o.northOffsetDeg, month);
    let clean = 0, dirty = 0, noShade = 0, poaDay = 0;
    const row: number[] = [];
    table.forEach((irr, i) => {
      const f = irr.up ? o.shadeAt(month, PROFILE_HOURS[i]) : null;
      let pClean = 0, pDirty = 0, pFree = 0, poaSum = 0;
      if (irr.up) {
        o.panels.forEach((p, k) => {
          const poa = panelPoa(p.normal, irr, f![k] ?? 0, a.albedo);
          const free = panelPoa(p.normal, irr, 0, a.albedo);
          poaSum += poa;
          pClean += acPerKwp(poa, irr.tempC, a.soilingCleanPct, a);
          pDirty += acPerKwp(poa, irr.tempC, a.soilingDirtyPct[month - 1], a);
          pFree += acPerKwp(free, irr.tempC, a.soilingCleanPct, a);
        });
      }
      // average over panels → per kWp
      row.push(round3(pClean / n));
      clean += (pClean / n) * STEP_H;
      dirty += (pDirty / n) * STEP_H;
      noShade += (pFree / n) * STEP_H;
      poaDay += ((poaSum / n) * STEP_H) / 1000;
    });
    const d = DAYS[month - 1];
    months.push({ month, days: d, clean: round1(clean * d), dirty: round1(dirty * d), noShade: round1(noShade * d), poa: round1(poaDay * d) });
    profile.push(row);
    poaYear += poaDay * d;
  }
  const sum = (k: "clean" | "dirty" | "noShade") => round1(months.reduce((s, m) => s + m[k], 0));
  const annual = { clean: sum("clean"), dirty: sum("dirty"), noShade: sum("noShade") };
  return {
    hours: PROFILE_HOURS,
    months,
    profile,
    annual,
    performanceRatio: poaYear > 0 ? Math.round((annual.clean / poaYear) * 1000) / 1000 : 0,
    assumptions: a,
    method:
      "Estimate per kWp: long-term average sunshine for West Bengal (NASA POWER), sun position for the site every 30 min on the 21st of each month, " +
      "irradiance on each panel's actual tilt and direction, shading from the 3D model, panel temperature, system losses and dust.",
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Scales a per-kWp estimate to a system size. */
export function scaleEstimate(e: EnergyEstimate, kwp: number) {
  return {
    annualClean: Math.round(e.annual.clean * kwp),
    annualDirty: Math.round(e.annual.dirty * kwp),
    annualNoShade: Math.round(e.annual.noShade * kwp),
    months: e.months.map((m) => ({ ...m, clean: Math.round(m.clean * kwp), dirty: Math.round(m.dirty * kwp), noShade: Math.round(m.noShade * kwp) })),
  };
}

/** Panel tilt (° from horizontal) and facing direction (compass °) from a model-space normal. */
export function tiltAzimuth(n: [number, number, number], northOffsetDeg: number) {
  const tilt = (Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
  const model = (Math.atan2(n[0], -n[2]) * 180) / Math.PI;
  const azimuth = (((model + northOffsetDeg) % 360) + 360) % 360;
  return { tilt, azimuth };
}
