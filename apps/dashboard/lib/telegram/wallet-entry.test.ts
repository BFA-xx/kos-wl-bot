import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";

const mocks = vi.hoisted(() => ({
  conversationFindUnique: vi.fn(),
  conversationDelete: vi.fn(),
  accountFindUnique: vi.fn(),
  walletUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramConversation: {
      findUnique: mocks.conversationFindUnique,
      delete: mocks.conversationDelete,
    },
    connectedAccount: { findUnique: mocks.accountFindUnique },
    walletProfile: { upsert: mocks.walletUpsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (plain: string) => `enc:${plain}`,
}));

import { buildTelegramEntryRequirements } from "@/lib/telegram/entry-requirements";
import {
  parseWalletCallback,
  registerTelegramWalletHandlers,
  walletCallbackData,
} from "@/lib/telegram/wallet-entry";

const XMR =
  "888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H";

function testBot(laterHandler: () => void) {
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
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  const replies = {
    get edits() {
      return calls
        .filter((c) => c.method === "editMessageText")
        .map((c) => ({
          id: c.payload.message_id,
          text: String(c.payload.text),
        }));
    },
    get deleted() {
      return calls
        .filter((c) => c.method === "deleteMessage")
        .map((c) => c.payload.message_id);
    },
    get sent() {
      return calls.filter((c) => c.method === "sendMessage").length;
    },
  };
  registerTelegramWalletHandlers(bot);
  bot.on("message:text", async () => laterHandler());
  return { bot, replies };
}

function privateText(text: string): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private", first_name: "Whale" },
      from: { id: 42, is_bot: false, first_name: "Whale" },
      text,
    },
  };
}

const openStep = {
  id: "conv-1",
  expiresAt: new Date(Date.now() + 60_000),
  payload: { chain: "MONERO", tokenId: "tok_123", messageId: 77 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("Telegram wallet entry", () => {
  it("round-trips callback data and rejects unknown chains", () => {
    const data = walletCallbackData("tok_123", "MONERO");
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseWalletCallback(data)).toEqual({
      tokenId: "tok_123",
      chain: "MONERO",
    });
    expect(parseWalletCallback("w:tok_123:DOGE")).toBeNull();
  });

  it("offers an in-chat button per accepted chain on a missing wallet", () => {
    const { keyboard } = buildTelegramEntryRequirements({
      tokenId: "tok_123",
      raffleId: 271,
      raffleTitle: "GTD Spots",
      discordOnly: false,
      walletChains: ["MONERO"],
      gates: [
        {
          key: "wallet",
          label: "Registered Monero (XMR) wallet",
          ok: false,
          reason: "Add a wallet on the Wallets page first.",
          url: "/me/wallets",
        },
      ],
    });
    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons).toContainEqual({
      text: "Add Monero (XMR) wallet",
      callback_data: "w:tok_123:MONERO",
    });
    expect(buttons.some((b) => b.text === "Add required wallet")).toBe(true);
  });

  it("passes text through when no wallet step is open", async () => {
    mocks.conversationFindUnique.mockResolvedValue(null);
    const later = vi.fn();
    const { bot } = testBot(later);
    await bot.handleUpdate(privateText("hello"));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid address on the same message and keeps the step open", async () => {
    mocks.conversationFindUnique.mockResolvedValue(openStep);
    mocks.accountFindUnique.mockResolvedValue({ userId: "discord-1" });
    const { bot, replies } = testBot(vi.fn());
    await bot.handleUpdate(privateText("0x1234"));
    expect(mocks.walletUpsert).not.toHaveBeenCalled();
    expect(mocks.conversationDelete).not.toHaveBeenCalled();
    expect(replies.deleted).toEqual([1]);
    expect(replies.sent).toBe(0);
    expect(replies.edits).toHaveLength(1);
    expect(replies.edits[0].id).toBe(77);
    expect(replies.edits[0].text).toContain(
      "isn't a valid Monero (XMR) address",
    );
  });

  it("saves a valid address encrypted, on the same message", async () => {
    mocks.conversationFindUnique.mockResolvedValue(openStep);
    mocks.accountFindUnique.mockResolvedValue({ userId: "discord-1" });
    const { bot, replies } = testBot(vi.fn());
    await bot.handleUpdate(privateText(` ${XMR} `));
    expect(mocks.walletUpsert).toHaveBeenCalledWith({
      where: { userId_chain: { userId: "discord-1", chain: "MONERO" } },
      create: { userId: "discord-1", chain: "MONERO", address: `enc:${XMR}` },
      update: { address: `enc:${XMR}` },
    });
    expect(replies.deleted).toEqual([1]);
    expect(replies.sent).toBe(0);
    expect(replies.edits[0].id).toBe(77);
    expect(replies.edits[0].text).toContain("MONERO (XMR) WALLET SAVED");
  });
});
