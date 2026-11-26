import { NextResponse, type NextRequest } from "next/server";
import { verifyJwt, TEAM_COOKIE } from "@/lib/auth/jwt";

// Protects internal pages and APIs. Role checks happen in each handler.
export async function middleware(req: NextRequest) {
  const claims = await verifyJwt<{ typ: string }>(req.cookies.get(TEAM_COOKIE)?.value);
  if (claims?.typ === "team") return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/team/:path*", "/api/team/:path*"] };
