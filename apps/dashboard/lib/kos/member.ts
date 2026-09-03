import { prisma } from "@/lib/db";
import {
  getKosPointsSummary,
  type KosPointsSummary,
} from "@/lib/telegram/points";
import {
  KOS_NOTIFICATION_KEYS,
  type KosNotificationPreferences,
} from "@/lib/kos/notifications";

/**
 * Website view of the KOS member economy.
 *
 * Points, levels, referrals and community access are keyed on `KosIdentity`,
 * not on the Discord-backed `User`, because a KOS identity can exist before —
 * or without — a Discord account. Telegram writes those tables; this module is
 * how the website reads the same rows, so a member sees one balance wherever
 * they look. Web parity rule: reuse the service, never mirror the state.
 *
 * `User.id` reaches an identity through the unique `KosIdentity.legacyUserId`
 * bridge, which `linkTelegramAccount` sets when a member connects Telegram
 * from their KOS profile. An unlinked member simply has no KOS identity yet.
 */

export interface KosCommunityAccess {
  communityId: string;
  communityName: string;
  /** Telegram group membership, independent of KOS approval. */
  status: "ACTIVE" | "LEFT" | "BANNED";
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: Date;
  reviewedAt: Date | null;
}

export interface KosPointAward {
  id: string;
  event: string;
  amount: number;
  reason: string;
  createdAt: Date;
}

export interface KosMemberSummary {
  identityId: string;
  displayName: string;
  onboardingStatus: "STARTED" | "PROFILE_COMPLETE" | "COMPLETED";
  points: KosPointsSummary;
  recentAwards: KosPointAward[];
  referral: {
    code: string | null;
    completed: number;
    pending: number;
  };
  communities: KosCommunityAccess[];
  notifications: KosNotificationPreferences;
  /** Linked providers, display metadata only — never wallet addresses. */
  providers: Array<{
    provider: string;
    username: string | null;
    displayName: string | null;
    verifiedAt: Date | null;
  }>;
}

const DEFAULT_NOTIFICATIONS: KosNotificationPreferences = {
  announcements: true,
  raffleReminders: true,
  winners: true,
  points: true,
  community: true,
};

/** Resolve the KOS identity bridged to a signed-in Discord user, if any. */
export async function findKosIdentityForUser(
  userId: string,
): Promise<{ id: string } | null> {
  return prisma.kosIdentity.findUnique({
    where: { legacyUserId: userId },
    select: { id: true },
  });
}

/**
 * Assemble everything the website shows about a member's KOS standing.
 * Returns null when the signed-in user has no KOS identity yet.
 */
export async function getKosMemberSummary(
  userId: string,
): Promise<KosMemberSummary | null> {
  const identity = await prisma.kosIdentity.findUnique({
    where: { legacyUserId: userId },
    select: {
      id: true,
      displayName: true,
      onboardingStatus: true,
      referralCode: true,
      accounts: {
        select: {
          provider: true,
          username: true,
          displayName: true,
          verifiedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      notificationPreference: true,
      telegramMemberships: {
        select: {
          communityId: true,
          status: true,
          approvalStatus: true,
          requestedAt: true,
          reviewedAt: true,
          community: { select: { communityName: true } },
        },
        orderBy: { requestedAt: "desc" },
      },
    },
  });
  if (!identity) return null;

  const [points, recent, referralCounts] = await Promise.all([
    getKosPointsSummary(identity.id),
    prisma.kosPointTransaction.findMany({
      where: { identityId: identity.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        event: true,
        amount: true,
        reason: true,
        createdAt: true,
      },
    }),
    prisma.kosReferral.groupBy({
      by: ["status"],
      where: { referrerIdentityId: identity.id },
      _count: { _all: true },
    }),
  ]);

  const referralByStatus = new Map(
    referralCounts.map((row) => [row.status, row._count._all]),
  );

  const stored = identity.notificationPreference;
  const notifications = stored
    ? (Object.fromEntries(
        KOS_NOTIFICATION_KEYS.map((key) => [key, stored[key]]),
      ) as KosNotificationPreferences)
    : { ...DEFAULT_NOTIFICATIONS };

  return {
    identityId: identity.id,
    displayName: identity.displayName,
    onboardingStatus: identity.onboardingStatus,
    points,
    recentAwards: recent,
    referral: {
      code: identity.referralCode,
      completed: referralByStatus.get("COMPLETED") ?? 0,
      pending: referralByStatus.get("PENDING") ?? 0,
    },
    communities: identity.telegramMemberships.map((membership) => ({
      communityId: membership.communityId,
      communityName: membership.community.communityName,
      status: membership.status,
      approvalStatus: membership.approvalStatus,
      requestedAt: membership.requestedAt,
      reviewedAt: membership.reviewedAt,
    })),
    notifications,
    providers: identity.accounts.map((account) => ({
      provider: account.provider,
      username: account.username,
      displayName: account.displayName,
      verifiedAt: account.verifiedAt,
    })),
  };
}
