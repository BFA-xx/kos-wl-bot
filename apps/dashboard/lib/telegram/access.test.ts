import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocks = vi.hoisted(() => ({
  connectedAccountFindUnique: vi.fn(),
  organizationFindMany: vi.fn(),
  telegramCommunityFindMany: vi.fn(),
  telegramActorHasPermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    connectedAccount: { findUnique: mocks.connectedAccountFindUnique },
    organization: { findMany: mocks.organizationFindMany },
    telegramCommunity: { findMany: mocks.telegramCommunityFindMany },
  },
}));

vi.mock("@/lib/telegram", () => ({
  telegramActorHasPermission: mocks.telegramActorHasPermission,
}));

import { findPrivateTelegramCommunityAccesses } from "@/lib/telegram/access";
import { PERMISSIONS } from "@/lib/permissions";

function privateContext(getChatMember: ReturnType<typeof vi.fn>) {
  return {
    from: { id: 42 },
    chat: { id: 42, type: "private" },
    api: { getChatMember },
    reply: vi.fn(),
  } as unknown as Context;
}

describe("private Telegram admin community discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectedAccountFindUnique.mockResolvedValue({ userId: "user-1" });
    mocks.organizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    mocks.telegramActorHasPermission.mockResolvedValue({
      ok: true,
      userId: "user-1",
    });
  });

  it("returns only communities where the KOS user is a current Telegram admin", async () => {
    mocks.telegramCommunityFindMany.mockResolvedValue([
      {
        id: "community-1",
        organizationId: "org-1",
        telegramChatId: "-1001",
        communityName: "KOS One",
      },
      {
        id: "community-2",
        organizationId: "org-1",
        telegramChatId: "-1002",
        communityName: "KOS Two",
      },
      {
        id: "community-3",
        organizationId: "org-1",
        telegramChatId: "-1003",
        communityName: "KOS Three",
      },
    ]);
    const getChatMember = vi
      .fn()
      .mockResolvedValueOnce({ status: "administrator" })
      .mockResolvedValueOnce({ status: "member" })
      .mockResolvedValueOnce({ status: "administrator" });
    mocks.telegramActorHasPermission
      .mockResolvedValueOnce({ ok: true, userId: "user-1" })
      .mockResolvedValueOnce({
        ok: false,
        reason: "Missing KOS permission: member:manage.",
      });

    const accesses = await findPrivateTelegramCommunityAccesses(
      privateContext(getChatMember),
      PERMISSIONS.MEMBER_MANAGE,
      "ONBOARDING",
    );

    expect(accesses.map(({ community }) => community.id)).toEqual([
      "community-1",
    ]);
    expect(mocks.telegramActorHasPermission).toHaveBeenCalledTimes(2);
    expect(mocks.telegramCommunityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          featureFlags: { has: "ONBOARDING" },
        }),
      }),
    );
  });

  it("requires the private Telegram account to be linked to KOS", async () => {
    mocks.connectedAccountFindUnique.mockResolvedValue(null);
    const ctx = privateContext(vi.fn());

    await expect(
      findPrivateTelegramCommunityAccesses(
        ctx,
        PERMISSIONS.MEMBER_MANAGE,
        "ONBOARDING",
      ),
    ).resolves.toEqual([]);
    expect(ctx.reply).toHaveBeenCalledWith(
      "Link this Telegram account to KOS first.",
    );
    expect(mocks.telegramCommunityFindMany).not.toHaveBeenCalled();
  });
});
