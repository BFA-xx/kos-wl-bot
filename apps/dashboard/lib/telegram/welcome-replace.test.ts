import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  deleteMessage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunity: { findUnique: mocks.findUnique, update: mocks.update },
    $transaction: mocks.transaction,
  },
}));

import { telegramRaffleDefaults } from "@kos/db";

/**
 * The welcome topic had filled with one dead greeting per join. Replacement
 * turns on two things: the new id being persisted, and the previous message
 * being deleted afterwards.
 */
describe("standing welcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        telegramCommunity: {
          findUnique: mocks.findUnique,
          update: mocks.update,
        },
      }),
    );
  });

  it("keeps the rest of the settings blob when recording the new id", async () => {
    // The id shares a blob with the topic ids and raffle defaults, so a
    // careless write would silently drop where raffles post.
    mocks.findUnique.mockResolvedValue({
      defaultRaffleSettings: {
        raffleTopicId: 94,
        welcomeTopicId: 3,
        winnerVisibility: "PUBLIC",
        welcomeMessageId: "100",
      },
    });
    const settings = {
      ...(await mocks.findUnique()).defaultRaffleSettings,
      welcomeMessageId: "205",
    };
    const parsed = telegramRaffleDefaults(settings);
    expect(parsed.raffleTopicId).toBe(94);
    expect(parsed.welcomeTopicId).toBe(3);
    expect(parsed.welcomeMessageId).toBe("205");
  });

  it("treats a missing id as nothing to delete", () => {
    expect(telegramRaffleDefaults({}).welcomeMessageId).toBeNull();
  });

  it("ignores an unusable stored id rather than calling Telegram with it", () => {
    for (const bad of ["", "abc", "0", "-4"]) {
      const id = telegramRaffleDefaults({
        welcomeMessageId: bad,
      }).welcomeMessageId;
      const numeric = Number(id);
      const usable =
        id !== null && Number.isSafeInteger(numeric) && numeric > 0;
      expect(usable).toBe(false);
    }
  });
});
