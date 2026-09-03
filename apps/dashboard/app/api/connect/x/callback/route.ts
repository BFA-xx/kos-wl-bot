import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeXCode, fetchXMe } from "@/lib/x-oauth";
import { consumeXLinkToken } from "@/lib/telegram/x-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * X OAuth callback, serving two flows through one registered redirect URI.
 *
 * X only accepts redirect URIs registered on the app, so the Telegram flow
 * cannot have a callback of its own without a portal edit — instead it sets an
 * identity cookie on the way out, and that cookie is what routes the return
 * here. Website members (no cookie) take the original path unchanged.
 */
export async function GET(req: NextRequest) {
  const telegramIdentityId = req.cookies.get("kos_x_tg_identity")?.value;
  if (telegramIdentityId) return telegramCallback(req, telegramIdentityId);

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

/**
 * The Telegram half: bind X to a KosIdentity, with no website account involved.
 *
 * The one-time link token is claimed only once the exchange succeeds, so a
 * member who cancels at X can reuse the same Telegram button.
 */
async function telegramCallback(
  req: NextRequest,
  identityId: string,
): Promise<NextResponse> {
  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const done = (status: string) => {
    const res = NextResponse.redirect(new URL(`/connect/x/telegram?x=${status}`, origin));
    for (const name of [
      "kos_x_state",
      "kos_x_verifier",
      "kos_x_tg_identity",
      "kos_x_tg_token",
    ]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
    return res;
  };

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("kos_x_state")?.value;
  const verifier = req.cookies.get("kos_x_verifier")?.value;
  const linkToken = req.cookies.get("kos_x_tg_token")?.value;

  if (!code || !state || !cookieState || state !== cookieState || !verifier || !linkToken) {
    return done("invalid_state");
  }

  const token = await exchangeXCode(code, `${origin}/api/connect/x/callback`, verifier);
  if (!token) return done("token_exchange_failed");

  const xUser = await fetchXMe(token.access_token);
  if (!xUser) return done("profile_fetch_failed");

  // One X account backs one identity, or it could clear the follow gate for an
  // unlimited number of Telegram accounts.
  const taken = await prisma.identityAccount.findUnique({
    where: { provider_externalId: { provider: "X", externalId: xUser.id } },
    select: { identityId: true },
  });
  if (taken && taken.identityId !== identityId) return done("already_linked_elsewhere");

  if (!(await consumeXLinkToken(linkToken))) return done("expired_link");

  const fields = {
    externalId: xUser.id,
    username: xUser.username,
    displayName: xUser.name,
    verifiedAt: new Date(),
    lastSeenAt: new Date(),
    accessToken: encryptSecret(token.access_token),
    refreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    metadata: { avatar: xUser.profile_image_url ?? null },
  };
  await prisma.identityAccount.upsert({
    where: { identityId_provider: { identityId, provider: "X" } },
    create: { identityId, provider: "X", ...fields },
    update: fields,
  });

  return done("linked");
}
