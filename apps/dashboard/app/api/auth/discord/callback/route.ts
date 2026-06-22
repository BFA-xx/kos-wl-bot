import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/session";
import { exchangeCode, fetchUser, authorizeUser } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("kos_oauth_state")?.value;

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, req.url));

  if (!code || !state || !cookieState || state !== cookieState) {
    return fail("invalid_state");
  }

  const secret = process.env.DASHBOARD_SESSION_TOKEN;
  if (!secret) return fail("auth_not_configured");

  const base = process.env.DASHBOARD_URL || url.origin;
  const redirectUri = `${base}/api/auth/discord/callback`;
  const token = await exchangeCode(code, redirectUri);
  if (!token) return fail("token_exchange_failed");

  const user = await fetchUser(token.access_token);
  if (!user) return fail("user_fetch_failed");

  const authz = await authorizeUser(token.access_token, user.id);
  if (!authz.ok) return fail(authz.reason ?? "not_authorized");

  const jwt = await signSession({ sub: user.id, name: user.global_name ?? user.username }, secret);

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  res.cookies.set("kos_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
