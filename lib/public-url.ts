// Absolute URL as the visitor sees the site. Behind a hosting proxy (e.g. Hostinger), req.url holds
// the app's internal address (https://0.0.0.0:3000/...), which browsers cannot open.
export function publicUrl(req: Request, pathOrUrl: string): URL {
  if (/^https?:\/\//i.test(pathOrUrl)) return new URL(pathOrUrl); // already absolute (e.g. S3)
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = process.env.APP_URL || (host && !host.startsWith("0.0.0.0") ? `${proto}://${host}` : new URL(req.url).origin);
  return new URL(pathOrUrl, base.replace(/\/$/, "") + "/");
}
