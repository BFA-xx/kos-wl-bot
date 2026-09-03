import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { exchangeXCode, fetchXMe } from "@/lib/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * X OAuth callback for a Telegram member — links X to their KOS identity.
 *
 * An X account may back only ONE identity, enforced by the unique
 * (provider, externalId) on identity_accounts. Without that, one X account
 * could satisfy the follow gate for an unlimited number of Telegram accounts,
 * which is exactly the abuse the gate exists to prevent.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.DASHBOARD_URL || req.nextUrl.origin;
  const done = (status: string) =>
    NextResponse.redirect(new URL(`/connect/x/telegram?x=${status}`, origin));

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("kos_x_tg_state")?.value;
  const verifier = req.cookies.get("kos_x_tg_verifier")?.value;
  const identityId = req.cookies.get("kos_x_tg_identity")?.value;

  const clear = (res: NextResponse) => {
    for (const name of ["kos_x_tg_state", "kos_x_tg_verifier", "kos_x_tg_identity"]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
    return res;
  };

  if (!code || !state || !cookieState || state !== cookieState || !verifier || !identityId) {
    return clear(done("invalid_state"));
  }

  const token = await exchangeXCode(
    code,
    `${origin}/api/connect/x/telegram/callback`,
    verifier,
  );
  if (!token) return clear(done("token_exchange_failed"));

  const xUser = await fetchXMe(token.access_token);
  if (!xUser) return clear(done("profile_fetch_failed"));

  const taken = await prisma.identityAccount.findUnique({
    where: { provider_externalId: { provider: "X", externalId: xUser.id } },
    select: { identityId: true },
  });
  if (taken && taken.identityId !== identityId) {
    return clear(done("already_linked_elsewhere"));
  }

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

  return clear(done("linked"));
}
