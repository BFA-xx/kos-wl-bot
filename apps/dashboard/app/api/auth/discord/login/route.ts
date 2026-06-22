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

  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state));
  res.cookies.set("kos_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
