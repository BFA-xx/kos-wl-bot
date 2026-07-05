import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { xConfigured, generatePkce, buildXAuthUrl } from "@/lib/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Begin X account linking (must already be signed in with Discord). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/me", req.url));
  }
  if (!xConfigured()) {
    return NextResponse.redirect(new URL("/me?x=not_configured", req.url));
  }

  const base = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const redirectUri = `${base}/api/connect/x/callback`;
  const state = crypto.randomUUID();
  const { verifier, challenge } = generatePkce();

  const res = NextResponse.redirect(buildXAuthUrl(redirectUri, state, challenge));
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("kos_x_state", state, cookieOpts);
  res.cookies.set("kos_x_verifier", verifier, cookieOpts);
  return res;
}
