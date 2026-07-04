import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl, oauthConfigured } from "@/lib/discord-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!oauthConfigured()) {
    return NextResponse.redirect(new URL("/login?error=oauth_not_configured", req.url));
  }
  const base = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const redirectUri = `${base}/api/auth/discord/callback`;
  const state = crypto.randomUUID();
  const next = req.nextUrl.searchParams.get("next");

  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state));
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("kos_oauth_state", state, cookieOpts);
  // Carry the post-login destination across the Discord round-trip.
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    res.cookies.set("kos_oauth_next", next, cookieOpts);
  }
  return res;
}
