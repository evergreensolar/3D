// Sun geometry helpers. Isomorphic (no three.js / DOM), used by viewer, processor and tests.
//
// Model coordinate convention (glTF, Y-up, metres): +X = east, +Y = up, −Z = north.
// This is what a SketchUp export produces when the green axis points north.
// `northOffsetDeg` = compass bearing the model's north (green axis) actually points to.
import { getPosition, getTimes } from "suncalc";
import { istDate, istHour } from "@/lib/time";

const D2R = Math.PI / 180;

export interface SunState {
  altitudeDeg: number;
  azimuthDeg: number; // compass bearing, clockwise from true north
  /** Unit vector pointing from the scene towards the sun, in model coordinates. */
  direction: [number, number, number];
  up: boolean;
}

export function sunState(date: Date, lat: number, lng: number, northOffsetDeg = 0): SunState {
  const p = getPosition(date, lat, lng);
  return {
    altitudeDeg: p.altitude,
    azimuthDeg: p.azimuth,
    direction: sunDirection(p.altitude, p.azimuth, northOffsetDeg),
    up: p.altitude > 0,
  };
}

export function sunDirection(altitudeDeg: number, azimuthDeg: number, northOffsetDeg = 0): [number, number, number] {
  const b = (azimuthDeg - northOffsetDeg) * D2R;
  const a = altitudeDeg * D2R;
  return [Math.sin(b) * Math.cos(a), Math.sin(a), -Math.cos(b) * Math.cos(a)];
}

/** Model-space horizontal unit vector for a true compass bearing. */
export function bearingVector(bearingDeg: number, northOffsetDeg = 0): [number, number, number] {
  const b = (bearingDeg - northOffsetDeg) * D2R;
  return [Math.sin(b), 0, -Math.cos(b)];
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compassPoint = (az: number) => POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

/** Sunrise / sunset as IST fractional hours. */
export function dayLight(year: number, month: number, day: number, lat: number, lng: number) {
  const t = getTimes(istDate(year, month, day, 12), lat, lng);
  return {
    sunrise: t.sunrise ? istHour(t.sunrise) : 6,
    sunset: t.sunset ? istHour(t.sunset) : 18,
    solarNoon: istHour(t.solarNoon),
  };
}

export const DATE_PRESETS = [
  { id: "summer", label: "Summer solstice", short: "21 Jun", month: 6, day: 21 },
  { id: "winter", label: "Winter solstice", short: "21 Dec", month: 12, day: 21 },
  { id: "march", label: "Spring equinox", short: "20 Mar", month: 3, day: 20 },
  { id: "sept", label: "Autumn equinox", short: "22 Sep", month: 9, day: 22 },
] as const;

/** Day of month used when picking a month on the slider (matches the solstice dates). */
export const MONTH_DAY = 21;

/** Half-hour samples from 9:00 to 16:00 IST used for the yearly shading summary. */
export const SUMMARY_HOURS = Array.from({ length: 15 }, (_, i) => 9 + i * 0.5);

/** Fixed simulation year so results are reproducible across reports. */
export const SIM_YEAR = 2026;
