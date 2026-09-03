import { NextResponse, type NextRequest } from "next/server";
import { buildXAuthUrl, generatePkce, xConfigured } from "@/lib/x-oauth";
import { peekXLinkToken } from "@/lib/telegram/x-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start X authorization for a Telegram member.
 *
 * Deliberately redirects to the SAME callback the website flow uses. X only
 * accepts redirect URIs registered on the app, so introducing a second one
 * meant every authorize was rejected until someone edited the developer
 * portal — a deploy-time trap with no signal in our own logs. The callback
 * tells the two flows apart by the identity cookie set below.
 *
 * The link token is validated here and claimed only on success, so a member who
 * cancels at X can tap the same link again.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/connect/x/telegram?x=${reason}`, origin));

  if (!xConfigured()) return fail("not_configured");

  const secret = req.nextUrl.searchParams.get("t");
  if (!secret) return fail("invalid_link");

  const identityId = await peekXLinkToken(secret);
  if (!identityId) return fail("expired_link");

  const state = crypto.randomUUID();
  const { verifier, challenge } = generatePkce();

  const res = NextResponse.redirect(
    buildXAuthUrl(`${origin}/api/connect/x/callback`, state, challenge),
  );
  const cookie = {
    httpOnly: true as const,
    secure: origin.startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("kos_x_state", state, cookie);
  res.cookies.set("kos_x_verifier", verifier, cookie);
  res.cookies.set("kos_x_tg_identity", identityId, cookie);
  res.cookies.set("kos_x_tg_token", secret, cookie);
  return res;
}
