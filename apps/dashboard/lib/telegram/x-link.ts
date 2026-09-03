import { randomBytes } from "node:crypto";
import { hashIntegrationToken } from "@kos/db";
import { prisma } from "@/lib/db";
import { dashboardOrigin } from "@/lib/telegram/format";

/**
 * One-time links that let a Telegram member authorize X against their KOS
 * identity, without ever creating a website account.
 *
 * The member never signs in here — they authorize with X itself, and the token
 * below is only what carries "which identity is this for" across to the OAuth
 * callback. It is single-use and short-lived, because anyone holding it could
 * otherwise attach their own X account to someone else's identity.
 */

const TTL_MS = 10 * 60_000;

export async function createXLinkUrl(identityId: string): Promise<string> {
  const secret = randomBytes(24).toString("base64url");
  await prisma.$transaction([
    // A member who restarts the step should not leave a usable link behind.
    prisma.integrationActionToken.deleteMany({
      where: {
        action: "X_IDENTITY_LINK",
        consumedAt: null,
        payload: { path: ["identityId"], equals: identityId },
      },
    }),
    prisma.integrationActionToken.create({
      data: {
        action: "X_IDENTITY_LINK",
        tokenHash: hashIntegrationToken(secret),
        payload: { identityId },
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    }),
  ]);
  return `${dashboardOrigin()}/api/connect/x/telegram/start?t=${secret}`;
}

/**
 * Validate a link token WITHOUT spending it.
 *
 * The token is checked when the member leaves for X but only claimed once they
 * come back successfully. Burning it up front meant any failure at X — a
 * rejected authorize, a cancelled prompt, a back button — left them holding a
 * dead link, and the Telegram button still pointed at that same dead URL.
 */
export async function peekXLinkToken(secret: string): Promise<string | null> {
  const token = await prisma.integrationActionToken.findUnique({
    where: { tokenHash: hashIntegrationToken(secret) },
    select: { action: true, payload: true, expiresAt: true, consumedAt: true },
  });
  if (!token || token.action !== "X_IDENTITY_LINK") return null;
  if (token.consumedAt || token.expiresAt < new Date()) return null;
  return (token.payload as { identityId?: string } | null)?.identityId ?? null;
}

/**
 * Claim the token now that the link has actually completed.
 *
 * Still single-use: the window between leaving for X and returning is the only
 * time the link is replayable, and it is bounded by the ten-minute expiry.
 */
export async function consumeXLinkToken(secret: string): Promise<boolean> {
  const claimed = await prisma.integrationActionToken.updateMany({
    where: {
      tokenHash: hashIntegrationToken(secret),
      action: "X_IDENTITY_LINK",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  return claimed.count === 1;
}
