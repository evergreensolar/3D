// India has no DST, so IST is a fixed UTC+05:30 offset. All "wall clock" times in the
// portal are IST unless stated otherwise.
export const IST_OFFSET_MIN = 330;
export const TZ = "Asia/Kolkata";

/** Instant for an IST wall-clock time. `hour` may be fractional (12.5 = 12:30). */
export function istDate(year: number, month: number, day: number, hour = 0): Date {
  return new Date(Date.UTC(year, month - 1, day) + (hour * 60 - IST_OFFSET_MIN) * 60_000);
}

/** IST wall-clock fractional hour of an instant. */
export function istHour(d: Date): number {
  const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN) % 1440;
  return m / 60 + d.getUTCSeconds() / 3600;
}

export function formatHour(h: number): string {
  const total = Math.round(h * 60);
  let hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatIST(d: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(new Date(d)) + (opts.timeStyle ? " IST" : "");
}
