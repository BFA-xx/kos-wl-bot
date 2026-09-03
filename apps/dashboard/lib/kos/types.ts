import type { KosNotificationPreferences } from "@/lib/kos/notifications";

/**
 * Wire shape of `GET /api/me/kos`. Kept separate from `lib/kos/member.ts`
 * because that module imports Prisma and client components cannot. Dates are
 * strings here — they have been through JSON.
 */

export interface KosMemberLevel {
  level: number;
  name: string;
  minPoints: number;
}

export interface KosMemberCommunity {
  communityId: string;
  communityName: string;
  status: "ACTIVE" | "LEFT" | "BANNED";
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  reviewedAt: string | null;
}

export interface KosMemberAward {
  id: string;
  event: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface KosMemberLinked {
  linked: true;
  identityId: string;
  displayName: string;
  onboardingStatus: "STARTED" | "PROFILE_COMPLETE" | "COMPLETED";
  points: {
    points: number;
    level: KosMemberLevel | null;
    nextLevel: KosMemberLevel | null;
  };
  recentAwards: KosMemberAward[];
  referral: { code: string | null; completed: number; pending: number };
  communities: KosMemberCommunity[];
  notifications: KosNotificationPreferences;
  providers: Array<{
    provider: string;
    username: string | null;
    displayName: string | null;
    verifiedAt: string | null;
  }>;
}

export type KosMemberResponse = KosMemberLinked | { linked: false };
