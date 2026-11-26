import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { LocalStorage } from "@/lib/storage/local";
import { verify } from "@/lib/storage/sign";

export const runtime = "nodejs";

/** Serves objects of the local storage driver. Every URL is HMAC-signed and time-limited. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const s = storage();
  if (!(s instanceof LocalStorage)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const dl = url.searchParams.get("dl") ?? "";
  if (!verify(key + dl, exp, url.searchParams.get("sig") ?? "")) {
    return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  if (!(await s.exists(key))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await s.get(key);
  const headers: Record<string, string> = {
    "content-type": await s.contentType(key),
    "content-length": String(body.length),
    "cache-control": "private, max-age=3600",
  };
  if (dl) headers["content-disposition"] = `attachment; filename="${dl.replace(/[^\w.\- ]/g, "_")}"`;
  return new NextResponse(new Uint8Array(body), { headers });
}
