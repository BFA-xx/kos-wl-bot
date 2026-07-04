import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, superAdminPatch } from "@/lib/auth";
import { signSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode, fetchUser, avatarUrl } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Discord OAuth callback. Any valid Discord login is accepted — authorization
 * to a given organization is enforced per-request by membership + permissions.
 * We persist the user (avatar, email, encrypted tokens) so we can call Discord
 * on their behalf (e.g. list servers to connect) and refresh tokens later.
 */
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

  const displayName = user.global_name ?? user.username;
  const authFields = {
    username: user.username,
    globalName: user.global_name ?? null,
    avatarUrl: avatarUrl(user),
    email: user.email ?? null,
    accessToken: encryptSecret(token.access_token),
    refreshToken: encryptSecret(token.refresh_token),
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    ...superAdminPatch(user.id),
    lastLoginAt: new Date(),
  };
  await prisma.user.upsert({
    where: { id: user.id },
    create: { id: user.id, ...authFields },
    update: authFields,
  });

  const next = safeNext(req.cookies.get("kos_oauth_next")?.value);
  const jwt = await signSession({ sub: user.id, name: displayName }, secret);

  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  res.cookies.set("kos_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("kos_oauth_next", "", { path: "/", maxAge: 0 });
  return res;
}

/** Only allow same-site relative redirects. */
function safeNext(next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}
