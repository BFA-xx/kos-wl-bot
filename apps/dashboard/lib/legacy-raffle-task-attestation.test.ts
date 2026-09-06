import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    log: {
      findFirst: mocks.findFirst,
      create: mocks.create,
    },
  },
}));

import { attestLegacyRaffleTask } from "@/lib/legacy-raffle-task-attestation";

const task = {
  id: "social-192-1-0123456789ab",
  key: "legacy:192:1:0123456789ab",
  sharedKey: "legacy-url:0123456789abcdef",
  label: "LIKE & RT",
  url: "https://x.com/KOS/status/123",
};

describe("legacy raffle task Telegram attestation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: 1 });
  });

  it("records completion for the Telegram-linked KOS user", async () => {
    await expect(
      attestLegacyRaffleTask({
        guildId: "guild-1",
        raffleId: 192,
        userId: "discord-user-74",
        username: "cryptowhale74",
        task,
        method: "telegram_attest",
      }),
    ).resolves.toEqual({ created: true });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guildId: "guild-1",
        raffleId: 192,
        actorId: "discord-user-74",
        action: "SOCIAL_TASK_VERIFY",
        metadata: expect.objectContaining({
          taskKey: task.key,
          sharedTaskKey: task.sharedKey,
          method: "telegram_attest",
        }),
      }),
    });
  });

  it("does not duplicate an existing completion", async () => {
    mocks.findFirst.mockResolvedValue({ id: 7 });

    await expect(
      attestLegacyRaffleTask({
        guildId: "guild-1",
        raffleId: 192,
        userId: "discord-user-74",
        username: "cryptowhale74",
        task,
        method: "telegram_attest",
      }),
    ).resolves.toEqual({ created: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
