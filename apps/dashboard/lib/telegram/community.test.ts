import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communityMemberFindMany: vi.fn(),
  communityMemberFindFirst: vi.fn(),
  communityMemberUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunityMember: {
      findMany: mocks.communityMemberFindMany,
      findFirst: mocks.communityMemberFindFirst,
      updateMany: mocks.communityMemberUpdateMany,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/telegram", () => ({
  didTelegramMemberJoin: vi.fn(),
}));

import {
  findTelegramCommunityReapplications,
  restartTelegramCommunityApplication,
} from "@/lib/telegram/community";

describe("Telegram community reapplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        telegramCommunityMember: {
          findFirst: mocks.communityMemberFindFirst,
          updateMany: mocks.communityMemberUpdateMany,
        },
        auditLog: { create: mocks.auditCreate },
      }),
    );
  });

  it("finds only terminal applications for communities the member left", async () => {
    mocks.communityMemberFindMany.mockResolvedValue([
      { community: { id: "community-1", communityName: "KOS Raffles" } },
    ]);

    await expect(
      findTelegramCommunityReapplications({
        telegramUserId: "74",
        identityId: "identity-1",
      }),
    ).resolves.toEqual([{ id: "community-1", communityName: "KOS Raffles" }]);
    expect(mocks.communityMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LEFT",
          approvalStatus: { in: ["APPROVED", "REJECTED"] },
        }),
      }),
    );
  });

  it("opens a fresh pending review without replacing the KOS identity", async () => {
    mocks.communityMemberFindFirst.mockResolvedValue({
      id: "member-1",
      approvalStatus: "APPROVED",
      community: {
        id: "community-1",
        organizationId: "org-1",
        communityName: "KOS Raffles",
      },
    });
    mocks.communityMemberUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });

    await expect(
      restartTelegramCommunityApplication({
        communityId: "community-1",
        telegramUserId: "74",
        identityId: "identity-1",
      }),
    ).resolves.toEqual({
      communityId: "community-1",
      communityName: "KOS Raffles",
    });
    expect(mocks.communityMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          identityId: "identity-1",
          status: "LEFT",
          approvalStatus: "APPROVED",
        }),
        data: expect.objectContaining({
          approvalStatus: "PENDING",
          reviewedAt: null,
          reviewedById: null,
          requestedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TELEGRAM_ACCESS_REAPPLIED",
          targetId: "member-1",
          metadata: expect.objectContaining({ identityId: "identity-1" }),
        }),
      }),
    );
  });

  it("does not reopen active, banned, or already-pending access", async () => {
    mocks.communityMemberFindFirst.mockResolvedValue(null);

    await expect(
      restartTelegramCommunityApplication({
        communityId: "community-1",
        telegramUserId: "74",
        identityId: "identity-1",
      }),
    ).resolves.toBeNull();
    expect(mocks.communityMemberUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
