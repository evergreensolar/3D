export function clientMeta(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return {
    ip: (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") ?? "").trim() || undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}
