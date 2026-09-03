import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/access";

/**
 * Admin repair for Telegram X links.
 *
 * The follow gate binds one X account to one KOS identity permanently, which is
 * what stops a single X account clearing onboarding for a crowd of Telegram
 * accounts. The cost of that strictness is that a member who authorizes the
 * wrong account is stuck with no way out — so an admin needs a way to release
 * the binding. Unlinking frees the X account for a different identity, so it is
 * super-admin only and always audited.
 */

export interface XLinkSummary {
  identityId: string;
  displayName: string;
  telegramUsername: string | null;
  xHandle: string | null;
  xUserId: string;
  linkedAt: Date | null;
  followConfirmed: boolean;
}

const followTargets = (metadata: unknown): string[] => {
  const value = (metadata as { followedTargets?: unknown } | null)?.followedTargets;
  return Array.isArray(value) ? (value as string[]) : [];
};

/** Search linked X accounts by X handle, Telegram handle, display name or id. */
export async function findXLinks(query = "", limit = 25): Promise<XLinkSummary[]> {
  const term = query.trim().replace(/^@/u, "");
  const rows = await prisma.identityAccount.findMany({
    where: {
      provider: "X",
      ...(term
        ? {
            OR: [
              { username: { contains: term, mode: "insensitive" as const } },
              { externalId: term },
              { identityId: term },
              {
                identity: {
                  OR: [
                    { displayName: { contains: term, mode: "insensitive" as const } },
                    {
                      accounts: {
                        some: {
                          provider: "TELEGRAM",
                          username: { contains: term, mode: "insensitive" as const },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    select: {
      identityId: true,
      username: true,
      externalId: true,
      verifiedAt: true,
      metadata: true,
      identity: {
        select: {
          displayName: true,
          accounts: {
            where: { provider: "TELEGRAM" },
            select: { username: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(limit, 100),
  });

  return rows.map((row) => ({
    identityId: row.identityId,
    displayName: row.identity.displayName,
    telegramUsername: row.identity.accounts[0]?.username ?? null,
    xHandle: row.username,
    xUserId: row.externalId,
    linkedAt: row.verifiedAt,
    followConfirmed: followTargets(row.metadata).length > 0,
  }));
}

export type UnlinkResult =
  | { ok: true; xHandle: string | null; identityId: string }
  | { ok: false; reason: string };

/**
 * Release a member's X link so they can authorize a different account.
 *
 * Deleting the row also drops the recorded follow pass it carried, so the gate
 * resets cleanly rather than leaving a member "confirmed" against an account
 * they no longer have linked.
 */
export async function unlinkIdentityX(
  identityId: string,
  actorId: string | null,
): Promise<UnlinkResult> {
  const existing = await prisma.identityAccount.findUnique({
    where: { identityId_provider: { identityId, provider: "X" } },
    select: { username: true, externalId: true },
  });
  if (!existing) return { ok: false, reason: "That member has no X account linked." };

  await prisma.identityAccount.delete({
    where: { identityId_provider: { identityId, provider: "X" } },
  });

  // Audit against whichever community the member belongs to. AuditLog is
  // org-scoped and identities are not, so a member with no community is
  // unlinked without a row rather than blocked on bookkeeping.
  const membership = await prisma.telegramCommunityMember.findFirst({
    where: { identityId },
    select: { community: { select: { organizationId: true } } },
  });
  if (membership) {
    await logAudit(
      membership.community.organizationId,
      actorId,
      "TELEGRAM_X_UNLINKED",
      {
        targetType: "kos_identity",
        targetId: identityId,
        metadata: { xHandle: existing.username, xUserId: existing.externalId },
      },
    );
  }

  return { ok: true, xHandle: existing.username, identityId };
}
