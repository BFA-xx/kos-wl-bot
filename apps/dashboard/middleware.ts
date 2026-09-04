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
  const isDiscordMemberFeed =
    /^\/api\/[^/]+\/integrations\/discord-members$/u.test(pathname);

  // The X link flow a Telegram member walks carries its own authentication and
  // must NOT require a dashboard session: they open it in Telegram's in-app
  // browser, where no kos_session cookie exists. `start` is authorized by a
  // signed single-use link token in ?t, `callback` by the OAuth state matching
  // an httpOnly cookie plus PKCE, and the result page only renders a status
  // code. Same reasoning as /api/auth, which is allowlisted for the Discord
  // OAuth flow. Without this the middleware answers {"error":"unauthorized"}
  // before the route runs, and only members who had previously signed into the
  // dashboard in that same in-app browser get through.
  const isXLinkFlow =
    pathname === "/api/connect/x/telegram/start" ||
    pathname === "/api/connect/x/callback" ||
    pathname === "/connect/x/telegram";

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/integrations/telegram/webhook" ||
    isXLinkFlow ||
    isDiscordMemberFeed ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png"
  ) {
    return NextResponse.next();
  }

  const secret = process.env.DASHBOARD_SESSION_TOKEN;
  if (!secret) return NextResponse.next(); // auth disabled

  const session = await verifySession(
    req.cookies.get(SESSION_COOKIE)?.value,
    secret,
  );
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
