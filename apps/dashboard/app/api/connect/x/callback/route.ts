import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeXCode, fetchXMe } from "@/lib/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * X OAuth callback → link the X account to the signed-in KOS user.
 * An X account can be linked to only ONE KOS user (anti-alt), enforced by the
 * unique (provider, externalId) constraint.
 */
export async function GET(req: NextRequest) {
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/me?x=${encodeURIComponent(reason)}`, req.url));

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/me", req.url));

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("kos_x_state")?.value;
  const verifier = req.cookies.get("kos_x_verifier")?.value;
  if (!code || !state || !cookieState || state !== cookieState || !verifier) {
    return fail("invalid_state");
  }

  const base = process.env.DASHBOARD_URL || url.origin;
  const token = await exchangeXCode(code, `${base}/api/connect/x/callback`, verifier);
  if (!token) return fail("token_exchange_failed");

  const xUser = await fetchXMe(token.access_token);
  if (!xUser) return fail("profile_fetch_failed");

  // Reject if this X account already belongs to a DIFFERENT KOS user.
  const taken = await prisma.connectedAccount.findUnique({
    where: { provider_externalId: { provider: "X", externalId: xUser.id } },
  });
  if (taken && taken.userId !== user.id) return fail("already_linked_elsewhere");

  const fields = {
    externalId: xUser.id,
    handle: xUser.username,
    accessToken: encryptSecret(token.access_token),
    refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    metadata: { name: xUser.name, avatar: xUser.profile_image_url ?? null },
  };
  await prisma.connectedAccount.upsert({
    where: { userId_provider: { userId: user.id, provider: "X" } },
    create: { userId: user.id, provider: "X", ...fields },
    update: fields,
  });

  const res = NextResponse.redirect(new URL("/me?x=linked", req.url));
  res.cookies.set("kos_x_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("kos_x_verifier", "", { path: "/", maxAge: 0 });
  return res;
}
