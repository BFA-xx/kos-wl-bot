import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifySession, type SessionPayload } from "@/lib/session";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/discord-oauth";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "kos_session";

/** The HMAC secret used to sign/verify session cookies. */
export function sessionSecret(): string | undefined {
  return process.env.DASHBOARD_SESSION_TOKEN;
}

/** Discord IDs granted KOS super-admin (Super Admin console). */
export function superAdminIds(): string[] {
  return (process.env.SUPER_ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSuperAdminId(id: string): boolean {
  return superAdminIds().includes(id);
}

/**
 * The `isSuperAdmin` value to write on login. The env allowlist is GRANT-ONLY:
 * an id in SUPER_ADMIN_DISCORD_IDS becomes super-admin, but login never revokes
 * (so a grant made via the /admin Users toggle isn't wiped, and the owner can't
 * be locked out). Revoking is done in the UI.
 */
export function superAdminPatch(id: string): { isSuperAdmin?: boolean } {
  return superAdminIds().includes(id) ? { isSuperAdmin: true } : {};
}

/** Read + verify the signed session cookie (server-side). */
export async function getSession(): Promise<SessionPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token, secret);
}

/** The logged-in User row, or null. */
export async function getSessionUser(): Promise<User | null> {
  const session = await getSession();
  if (!session?.sub) return null;
  return prisma.user.findUnique({ where: { id: session.sub } });
}

/**
 * Return a currently-valid Discord access token for a user, refreshing it via
 * the stored refresh token if it's expired (and persisting the rotated tokens).
 * Returns null if the user never linked or the refresh fails.
 */
export async function getValidAccessToken(
  userId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) return null;

  const notExpired =
    user.tokenExpiresAt && user.tokenExpiresAt.getTime() - 60_000 > Date.now();
  if (notExpired) return decryptSecret(user.accessToken);

  if (!user.refreshToken) return null;
  const refreshed = await refreshAccessToken(decryptSecret(user.refreshToken));
  if (!refreshed) return waitForConcurrentTokenRefresh(userId);

  const updated = await prisma.user.updateMany({
    where: { id: userId, refreshToken: user.refreshToken },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      refreshToken: encryptSecret(refreshed.refresh_token),
      tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  if (updated.count === 0) {
    return waitForConcurrentTokenRefresh(userId);
  }
  return refreshed.access_token;
}

/**
 * Discord rotates refresh tokens. If another request refreshed the same user
 * first, wait briefly for its database update and reuse the newly stored token.
 */
async function waitForConcurrentTokenRefresh(
  userId: string,
): Promise<string | null> {
  for (const delayMs of [75, 200, 400]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const latest = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessToken: true, tokenExpiresAt: true },
    });
    if (
      latest?.accessToken &&
      latest.tokenExpiresAt &&
      latest.tokenExpiresAt.getTime() - 30_000 > Date.now()
    ) {
      return decryptSecret(latest.accessToken);
    }
  }
  return null;
}
