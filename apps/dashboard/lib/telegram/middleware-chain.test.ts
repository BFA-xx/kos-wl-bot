import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";

const mocks = vi.hoisted(() => ({
  conversationFindUnique: vi.fn(),
  ensureTelegramIdentity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramConversation: { findUnique: mocks.conversationFindUnique },
  },
}));
vi.mock("@/lib/telegram/identity", () => ({
  ensureTelegramIdentity: mocks.ensureTelegramIdentity,
}));

import { registerTelegramRaffleHandlers } from "@/lib/telegram/raffles";

/**
 * `registerTelegramRaffleHandlers` ends with a `message:text` catch-all. If that
 * handler returns without calling next(), grammY stops the chain and every
 * handler registered afterwards goes silently dead — which is how /raffletopic
 * shipped broken. Anything registered later must still receive the update.
 */
function botWithLaterHandler(spy: () => void) {
  const bot = new Bot("12345:test-token-not-real", {
    botInfo: {
      id: 12345,
      is_bot: true,
      first_name: "KOS Bot",
      username: "kos_test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  registerTelegramRaffleHandlers(bot);
  bot.command("raffletopic", async () => spy());
  bot.on("message:text", async () => spy());
  return bot;
}

function textUpdate(text: string, chatType: "private" | "supergroup"): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: -100, type: chatType, title: "KOS" },
      from: { id: 42, is_bot: false, first_name: "Whale" },
      text,
      entities: text.startsWith("/")
        ? [
            {
              type: "bot_command",
              offset: 0,
              length: text.split(" ")[0].length,
            },
          ]
        : undefined,
    },
  } as Update;
}

describe("Telegram middleware chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversationFindUnique.mockResolvedValue(null);
    mocks.ensureTelegramIdentity.mockResolvedValue({ id: "identity-1" });
  });

  it("lets a group command through the quick-raffle text catch-all", async () => {
    const spy = vi.fn();
    await botWithLaterHandler(spy).handleUpdate(
      textUpdate("/raffletopic", "supergroup"),
    );
    expect(spy).toHaveBeenCalled();
  });

  it("lets ordinary private text through when no setup is running", async () => {
    const spy = vi.fn();
    await botWithLaterHandler(spy).handleUpdate(textUpdate("gm", "private"));
    expect(spy).toHaveBeenCalled();
  });

  it("still consumes a reply that belongs to a running quick raffle", async () => {
    mocks.conversationFindUnique.mockResolvedValue({
      id: "conv-1",
      step: "TITLE",
      payload: {},
      expiresAt: new Date(Date.now() + 60_000),
      communityId: "community-1",
    });
    const spy = vi.fn();
    const bot = botWithLaterHandler(spy);
    // A live setup owns this message, so nothing downstream should see it.
    await bot
      .handleUpdate(textUpdate("My prize title", "private"))
      .catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});
