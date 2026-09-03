import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identityFindUnique: vi.fn(),
  transactionFindMany: vi.fn(),
  referralGroupBy: vi.fn(),
  pointsSummary: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    kosIdentity: { findUnique: mocks.identityFindUnique },
    kosPointTransaction: { findMany: mocks.transactionFindMany },
    kosReferral: { groupBy: mocks.referralGroupBy },
  },
}));

vi.mock("@/lib/telegram/points", () => ({
  getKosPointsSummary: mocks.pointsSummary,
}));

import { getKosMemberSummary } from "@/lib/kos/member";
import { parseKosNotificationPatch } from "@/lib/kos/notifications";

const identity = {
  id: "identity-1",
  displayName: "Crypto Whale",
  onboardingStatus: "COMPLETED",
  referralCode: "abc123",
  accounts: [
    {
      provider: "TELEGRAM",
      username: "cryptowhale74",
      displayName: "Crypto Whale",
      verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ],
  notificationPreference: null,
  telegramMemberships: [
    {
      communityId: "community-1",
      status: "LEFT",
      approvalStatus: "PENDING",
      requestedAt: new Date("2026-09-02T00:00:00.000Z"),
      reviewedAt: null,
      community: { communityName: "KOS Raffles" },
    },
  ],
};

describe("KOS member web summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identityFindUnique.mockResolvedValue(identity);
    mocks.transactionFindMany.mockResolvedValue([
      {
        id: "tx-1",
        event: "ONBOARDING_COMPLETED",
        amount: 100,
        reason: "KOS Telegram onboarding approved",
        createdAt: new Date("2026-09-02T10:00:00.000Z"),
      },
    ]);
    mocks.referralGroupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 2 } },
      { status: "PENDING", _count: { _all: 1 } },
    ]);
    mocks.pointsSummary.mockResolvedValue({
      points: 100,
      level: { level: 1, name: "Member", minPoints: 0 },
      nextLevel: { level: 2, name: "Contributor", minPoints: 250 },
    });
  });

  it("reads the identity-keyed ledger the Telegram bot writes", async () => {
    const summary = await getKosMemberSummary("discord-user-1");

    expect(mocks.identityFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { legacyUserId: "discord-user-1" } }),
    );
    expect(mocks.pointsSummary).toHaveBeenCalledWith("identity-1");
    expect(summary?.points.points).toBe(100);
    expect(summary?.referral).toEqual({
      code: "abc123",
      completed: 2,
      pending: 1,
    });
    expect(summary?.recentAwards[0].amount).toBe(100);
  });

  it("keeps a member who left the group visible with their pending request", async () => {
    const summary = await getKosMemberSummary("discord-user-1");
    expect(summary?.communities).toEqual([
      {
        communityId: "community-1",
        communityName: "KOS Raffles",
        status: "LEFT",
        approvalStatus: "PENDING",
        requestedAt: new Date("2026-09-02T00:00:00.000Z"),
        reviewedAt: null,
      },
    ]);
  });

  it("defaults notification preferences when no row exists yet", async () => {
    const summary = await getKosMemberSummary("discord-user-1");
    expect(summary?.notifications).toEqual({
      announcements: true,
      raffleReminders: true,
      winners: true,
      points: true,
      community: true,
    });
  });

  it("reflects a stored preference row over the defaults", async () => {
    mocks.identityFindUnique.mockResolvedValue({
      ...identity,
      notificationPreference: {
        identityId: "identity-1",
        announcements: false,
        raffleReminders: true,
        winners: false,
        points: true,
        community: true,
      },
    });
    const summary = await getKosMemberSummary("discord-user-1");
    expect(summary?.notifications.announcements).toBe(false);
    expect(summary?.notifications.winners).toBe(false);
  });

  it("returns null when the signed-in user has no KOS identity", async () => {
    mocks.identityFindUnique.mockResolvedValue(null);
    await expect(getKosMemberSummary("discord-user-1")).resolves.toBeNull();
    expect(mocks.pointsSummary).not.toHaveBeenCalled();
  });
});

describe("KOS notification patch parsing", () => {
  it("accepts only known boolean keys", () => {
    expect(
      parseKosNotificationPatch({
        winners: false,
        points: true,
        identityId: "someone-else",
        announcements: "yes",
        nope: true,
      }),
    ).toEqual({ winners: false, points: true });
  });

  it("ignores malformed bodies", () => {
    expect(parseKosNotificationPatch(null)).toEqual({});
    expect(parseKosNotificationPatch("winners")).toEqual({});
    expect(parseKosNotificationPatch({})).toEqual({});
  });
});
