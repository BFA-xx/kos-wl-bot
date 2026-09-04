import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  communityUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/telegram/access", () => ({
  requireTelegramCommunityPermission: mocks.requirePermission,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunity: { update: mocks.communityUpdate },
    auditLog: { create: mocks.auditCreate },
  },
}));

import { configureTelegramTopic } from "@/lib/telegram/raffle-topic";

describe("Telegram community topics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      community: {
        id: "community-1",
        organizationId: "org-1",
        defaultRaffleSettings: { raffleTopicId: 12 },
      },
      userId: "user-1",
    });
    mocks.communityUpdate.mockResolvedValue({ id: "community-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("stores Start Here as the welcome topic without changing raffle routing", async () => {
    const reply = vi.fn().mockResolvedValue({ message_id: 3 });
    const ctx = {
      match: "",
      message: { message_thread_id: 77 },
      reply,
    } as unknown as Context;

    await configureTelegramTopic(ctx, {
      setting: "welcomeTopicId",
      command: "/welcometopic",
      subject: "KOS welcome messages",
      destination: "Start Here",
      auditAction: "TELEGRAM_WELCOME_TOPIC_SET",
    });

    expect(mocks.communityUpdate).toHaveBeenCalledWith({
      where: { id: "community-1" },
      data: {
        defaultRaffleSettings: {
          raffleTopicId: 12,
          welcomeTopicId: 77,
        },
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TELEGRAM_WELCOME_TOPIC_SET",
          metadata: { welcomeTopicId: 77 },
        }),
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      "KOS welcome messages will post in this topic from now on. Existing messages stay where they were posted.",
    );
  });
});
