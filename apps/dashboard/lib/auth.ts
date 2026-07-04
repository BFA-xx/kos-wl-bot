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
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) return null;

  const notExpired =
    user.tokenExpiresAt && user.tokenExpiresAt.getTime() - 60_000 > Date.now();
  if (notExpired) return decryptSecret(user.accessToken);

  if (!user.refreshToken) return null;
  const refreshed = await refreshAccessToken(decryptSecret(user.refreshToken));
  if (!refreshed) return null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      refreshToken: encryptSecret(refreshed.refresh_token),
      tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}
