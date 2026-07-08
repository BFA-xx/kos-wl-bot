import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

const SESSION_COOKIE = "kos_session";

/**
 * Gate every page/route behind a signed session (issued by Discord OAuth or the
 * password login). The login page and auth API are always reachable. If
 * DASHBOARD_SESSION_TOKEN is unset, auth is disabled (trusted network only).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const secret = process.env.DASHBOARD_SESSION_TOKEN;
  if (!secret) return NextResponse.next(); // auth disabled

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
