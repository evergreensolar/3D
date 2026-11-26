// Central, typed access to environment configuration (server only).
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}
const opt = (name: string, fallback = "") => process.env[name] || fallback;

export const env = {
  get appUrl() { return opt("APP_URL", "http://localhost:3000").replace(/\/$/, ""); },
  get sessionSecret() {
    const s = req("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  get isProd() { return process.env.NODE_ENV === "production"; },
  // Shows the OTP on screen. Only possible while SMS_PROVIDER=console (nothing is really sent).
  // Turn off before giving links to real customers.
  get devShowOtp() { return opt("DEV_SHOW_OTP") === "true" && opt("SMS_PROVIDER", "console") === "console"; },
  opt,
  req,
};
