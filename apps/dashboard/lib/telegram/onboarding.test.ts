import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocks = vi.hoisted(() => ({
  kosIdentityFindUnique: vi.fn(),
  communityMemberFindMany: vi.fn(),
  auditFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  telegramActorHasPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    kosIdentity: { findUnique: mocks.kosIdentityFindUnique },
    telegramCommunityMember: { findMany: mocks.communityMemberFindMany },
    auditLog: {
      findFirst: mocks.auditFindFirst,
      create: mocks.auditCreate,
    },
  },
}));

vi.mock("@/lib/telegram", () => ({
  telegramActorHasPermission: mocks.telegramActorHasPermission,
}));

import { notifyTelegramOnboardingAdmins } from "@/lib/telegram/onboarding";

describe("Telegram onboarding reviewer engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kosIdentityFindUnique.mockResolvedValue({
      displayName: "Crypto Whale",
      accounts: [
        { provider: "TELEGRAM", username: "cryptowhale74" },
        { provider: "X", username: "whale_on_x" },
      ],
    });
    mocks.communityMemberFindMany.mockResolvedValue([
      {
        id: "member-1",
        requestedAt: new Date("2026-09-03T08:00:00.000Z"),
        community: {
          id: "community-1",
          organizationId: "org-1",
          telegramChatId: "-1001",
          communityName: "KOS Raffles",
        },
      },
    ]);
    mocks.auditFindFirst.mockResolvedValue(null);
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.telegramActorHasPermission.mockResolvedValue({
      ok: true,
      userId: "admin-user-1",
    });
  });

  it("privately alerts an authorized reviewer once per access request", async () => {
    const getChatAdministrators = vi.fn().mockResolvedValue([
      {
        status: "administrator",
        user: { id: 99, is_bot: false, first_name: "Admin" },
      },
      {
        status: "administrator",
        user: { id: 100, is_bot: true, first_name: "KOS Bot" },
      },
    ]);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = {
      from: { id: 42 },
      chat: { id: 42, type: "private" },
      api: { getChatAdministrators, sendMessage },
    } as unknown as Context;

    await expect(
      notifyTelegramOnboardingAdmins(ctx, "identity-1"),
    ).resolves.toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("Crypto Whale (@cryptowhale74)"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    // Reviewers decide on the strength of the X account, so it has to be in
    // the notification itself.
    expect(sendMessage).toHaveBeenCalledWith(
      99,
      expect.stringContaining("X: @whale_on_x"),
      expect.anything(),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TELEGRAM_ACCESS_REVIEW_REQUESTED",
          targetId: "member-1",
        }),
      }),
    );
    expect(mocks.auditFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date("2026-09-03T08:00:00.000Z") },
        }),
      }),
    );

    mocks.auditFindFirst.mockResolvedValue({ id: "audit-1" });
    await expect(
      notifyTelegramOnboardingAdmins(ctx, "identity-1"),
    ).resolves.toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
