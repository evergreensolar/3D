import { NextResponse, type NextRequest } from "next/server";

// Fast gate for internal pages. The session itself is verified on the server
// (getTeamUser / requireTeamUser) because the signing secret lives in the runtime config.
export function middleware(req: NextRequest) {
  if (req.cookies.get("evg_t")?.value) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/team/:path*", "/api/team/:path*"] };
