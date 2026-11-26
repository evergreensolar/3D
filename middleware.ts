import { NextResponse, type NextRequest } from "next/server";

// Fast gate for internal pages. The session itself is verified on the server
// (getTeamUser / requireTeamUser) because the signing secret lives in the runtime config.
export function middleware(req: NextRequest) {
  if (req.cookies.get("evg_t")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

// Pages only. APIs check the session themselves — and must NOT pass through middleware, because
// Next.js buffers at most 10 MB of a request body there, which breaks large model uploads.
export const config = { matcher: ["/team/:path*"] };
