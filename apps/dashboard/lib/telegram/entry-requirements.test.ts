import { describe, expect, it } from "vitest";
import { buildTelegramEntryRequirements } from "@/lib/telegram/entry-requirements";

describe("Telegram raffle entry requirements", () => {
  it("names every failed step and gives one task-panel retry flow", () => {
    const result = buildTelegramEntryRequirements({
      tokenId: "token-1",
      raffleId: 177,
      raffleTitle: "KOS <Launch>",
      discordOnly: false,
      gates: [
        {
          key: "legacy-task-1",
          label: "Follow the project",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
        },
        {
          key: "legacy-task-2",
          label: "Like the announcement",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
        },
        {
          key: "legacy-task-3",
          label: "Join the partner community",
          ok: false,
          reason: "Open and verify this raffle step.",
          url: "/me/raffles?raffle=177",
        },
      ],
    });

    expect(result.text).toContain("Follow the project");
    expect(result.text).toContain("Like the announcement");
    expect(result.text).toContain("Join the partner community");
    expect(result.text).toContain("KOS &lt;Launch&gt;");
    expect(result.keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Complete raffle steps" }),
        expect.objectContaining({
          text: "Retry entry",
          callback_data: "a:token-1",
        }),
      ]),
    );
    expect(
      result.keyboard.inline_keyboard
        .flat()
        .filter(({ text }) => text === "Complete raffle steps"),
    ).toHaveLength(1);
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
});
