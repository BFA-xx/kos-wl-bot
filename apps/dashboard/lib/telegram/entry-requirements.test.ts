import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  buildTelegramEntryRequirements,
  sendTelegramEntryRequirements,
} from "@/lib/telegram/entry-requirements";

describe("Telegram raffle entry requirements", () => {
  it("names every failed step and gives one task-panel retry flow", () => {
    const result = buildTelegramEntryRequirements({
      tokenId: "token-1",
      raffleId: 177,
      raffleTitle: "KOS <Launch>",
      discordOnly: false,
      gates: [
        {
          key: "legacy-task-legacy:177:0:0123456789ab",
          label: "Follow the project",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
          actionUrl: "https://twitter.com/intent/follow?screen_name=Borosnfts",
        },
        {
          key: "legacy-task-legacy:177:1:1123456789ab",
          label: "Like the announcement",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
          actionUrl:
            "https://twitter.com/intent/like?tweet_id=2095532476278214964",
        },
        {
          key: "legacy-task-legacy:177:2:2123456789ab",
          label: "Join the partner community",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
          actionUrl:
            "https://twitter.com/intent/retweet?tweet_id=2095532476278214964",
        },
      ],
    });

    expect(result.text).toContain("Follow the project");
    expect(result.text).toContain("Like the announcement");
    expect(result.text).toContain("Join the partner community");
    expect(result.text).toContain("KOS &lt;Launch&gt;");
    expect(result.text).toContain("Open this task on X");
    expect(result.text).toContain(
      "https://twitter.com/intent/follow?screen_name=Borosnfts",
    );
    expect(result.keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Open on X: Follow the project",
          url: "https://twitter.com/intent/follow?screen_name=Borosnfts",
        }),
        expect.objectContaining({
          text: "Open on X: Like the announcement",
          url: "https://twitter.com/intent/like?tweet_id=2095532476278214964",
        }),
        expect.objectContaining({
          text: "Open on X: Join the partner community",
          url: "https://twitter.com/intent/retweet?tweet_id=2095532476278214964",
        }),
        expect.objectContaining({
          text: "I completed: Follow the project",
          callback_data: "tv:token-1:0:0123456789ab",
        }),
        expect.objectContaining({
          text: "I completed: Like the announcement",
          callback_data: "tv:token-1:1:1123456789ab",
        }),
        expect.objectContaining({
          text: "I completed: Join the partner community",
          callback_data: "tv:token-1:2:2123456789ab",
        }),
        expect.objectContaining({
          text: "Retry entry",
          callback_data: "a:token-1",
        }),
      ]),
    );
    expect(result.text).toContain("tap I completed below");
    expect(result.keyboard.inline_keyboard.flat()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Complete raffle steps" }),
      ]),
    );
  });

  it("includes hard-gate actions and Discord-only guidance", () => {
    const result = buildTelegramEntryRequirements({
      tokenId: "token-2",
      raffleId: 201,
      raffleTitle: "Wallet raffle",
      discordOnly: true,
      gates: [
        {
          key: "wallet",
          label: "Registered ETHEREUM wallet",
          ok: false,
          reason: "Add a wallet on the Wallets page first.",
          url: "/me/wallets",
        },
      ],
    });

    expect(result.text).toContain("Discord-only requirement");
    expect(result.keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Add required wallet" }),
      ]),
    );
  });

  it("redraws the checklist in place when Retry is pressed in the private chat", async () => {
    const editMessageText = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn();
    const reply = vi.fn();
    const ctx = {
      from: { id: 42 },
      callbackQuery: { message: { chat: { id: 42, type: "private" } } },
      editMessageText,
      reply,
      api: { sendMessage },
    } as unknown as Context;
    const delivered = await sendTelegramEntryRequirements(ctx, {
      tokenId: "tok_123",
      raffleId: 271,
      raffleTitle: "GTD Spots",
      discordOnly: false,
      gates: [{ key: "wallet", label: "Registered wallet", ok: false }],
    });
    expect(delivered).toBe(true);
    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});
