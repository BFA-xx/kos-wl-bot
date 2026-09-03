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

/** Consume a link token, returning the identity it was minted for. */
export async function consumeXLinkToken(secret: string): Promise<string | null> {
  const token = await prisma.integrationActionToken.findUnique({
    where: { tokenHash: hashIntegrationToken(secret) },
    select: { id: true, action: true, payload: true, expiresAt: true, consumedAt: true },
  });
  if (!token || token.action !== "X_IDENTITY_LINK") return null;
  if (token.consumedAt || token.expiresAt < new Date()) return null;

  const identityId = (token.payload as { identityId?: string } | null)?.identityId;
  if (!identityId) return null;

  // Claim it atomically so a shared link cannot be redeemed twice.
  const claimed = await prisma.integrationActionToken.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return claimed.count === 1 ? identityId : null;
}
