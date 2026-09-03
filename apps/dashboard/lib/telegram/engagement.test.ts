import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";

const mocks = vi.hoisted(() => ({
  communityFindUnique: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunity: { findUnique: mocks.communityFindUnique },
  },
}));

vi.mock("@/lib/telegram/rate-limit", () => ({
  consumeTelegramRateLimit: mocks.consumeRateLimit,
}));

import {
  containsKosGreeting,
  handleKosGreeting,
} from "@/lib/telegram/engagement";

function groupContext(text: string) {
  return {
    from: { id: 74, is_bot: false, first_name: "Crypto Whale" },
    chat: { id: -1001, type: "supergroup" },
    message: { message_id: 55, text },
    reply: vi.fn(),
  } as unknown as Context;
}

describe("KOS Telegram greeting engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.communityFindUnique.mockResolvedValue({
      status: "ACTIVE",
      featureFlags: ["GREETINGS"],
    });
    mocks.consumeRateLimit.mockResolvedValue(true);
  });

  it.each(["gm", "GM KOS", "well, gm everyone", "gKOS", "Good one, gkos!"])(
    "recognizes the greeting in %j",
    (text) => {
      expect(containsKosGreeting(text)).toBe(true);
    },
  );

  it.each(["programming", "segment", "gmos", "gkoss", "/gm"])(
    "does not match unrelated text in %j",
    (text) => {
      expect(containsKosGreeting(text)).toBe(false);
    },
  );

  it("replies directly in an enabled KOS community", async () => {
    const ctx = groupContext("gm KOS");
    const next = vi.fn() as unknown as NextFunction;

    await handleKosGreeting(ctx, next);

    expect(ctx.reply).toHaveBeenCalledWith("gKOS🖤", {
      reply_parameters: {
        message_id: 55,
        allow_sending_without_reply: true,
      },
    });
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(next).not.toHaveBeenCalled();
  });

  it("ignores ordinary messages without querying the community", async () => {
    const ctx = groupContext("good afternoon");
    const next = vi.fn() as unknown as NextFunction;

    await handleKosGreeting(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.communityFindUnique).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("silently limits greeting floods", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const ctx = groupContext("gkos");

    await handleKosGreeting(ctx, vi.fn());

    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
