import { NextResponse, type NextRequest } from "next/server";
import { buildXAuthUrl, generatePkce, xConfigured } from "@/lib/x-oauth";
import { consumeXLinkToken } from "@/lib/telegram/x-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start X authorization for a Telegram member.
 *
 * Unlike /api/connect/x/start this has no website session to lean on: the
 * one-time token in the URL is the only thing that says which KOS identity is
 * being linked, so it is consumed here and the identity is carried to the
 * callback in a short-lived, http-only cookie.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/connect/x/telegram?x=${reason}`, origin));

  if (!xConfigured()) return fail("not_configured");

  const secret = req.nextUrl.searchParams.get("t");
  if (!secret) return fail("invalid_link");

  const identityId = await consumeXLinkToken(secret);
  if (!identityId) return fail("expired_link");

  const state = crypto.randomUUID();
  const { verifier, challenge } = generatePkce();
  const redirectUri = `${origin}/api/connect/x/telegram/callback`;

  const res = NextResponse.redirect(buildXAuthUrl(redirectUri, state, challenge));
  const cookie = {
    httpOnly: true as const,
    secure: origin.startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("kos_x_tg_state", state, cookie);
  res.cookies.set("kos_x_tg_verifier", verifier, cookie);
  res.cookies.set("kos_x_tg_identity", identityId, cookie);
  return res;
}
