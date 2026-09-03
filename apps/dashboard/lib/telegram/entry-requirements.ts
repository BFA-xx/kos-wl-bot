import { InlineKeyboard, type Context } from "grammy";
import type { Gate } from "@/lib/raffle-entry";
import { dashboardOrigin, escapeTelegramHtml } from "@/lib/telegram/format";

interface TelegramEntryRequirements {
  tokenId: string;
  raffleId: number;
  raffleTitle: string;
  gates: Gate[];
  discordOnly: boolean;
}

function gateActionLabel(url: string): string {
  if (url.includes("/me/raffles")) return "Complete raffle steps";
  if (url.includes("/me/wallets")) return "Add required wallet";
  return "Open KOS profile";
}

export function buildTelegramEntryRequirements(
  input: TelegramEntryRequirements,
): { text: string; keyboard: InlineKeyboard } {
  const failed = input.gates.filter(({ ok }) => !ok);
  const lines = failed
    .slice(0, 12)
    .flatMap((gate, index) => [
      `${index + 1}. <b>${escapeTelegramHtml(gate.label.slice(0, 160))}</b>`,
      escapeTelegramHtml(
        (gate.reason ?? "Complete this requirement before entering.").slice(
          0,
          240,
        ),
      ),
    ]);
  if (failed.length > 12) {
    lines.push(`And ${failed.length - 12} more requirement(s).`);
  }
  if (input.discordOnly) {
    lines.push("", "This raffle also has a Discord-only requirement.");
  }

  const keyboard = new InlineKeyboard();
  const seenUrls = new Set<string>();
  for (const gate of failed) {
    if (!gate.url) continue;
    const url = new URL(gate.url, dashboardOrigin()).toString();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    keyboard.url(gateActionLabel(url), url).row();
  }
  keyboard
    .text("Retry entry", `a:${input.tokenId}`)
    .row()
    .text("Back to raffles", "raffles:list");

  return {
    text: [
      "<b>RAFFLE REQUIREMENTS</b>",
      "",
      `<b>#${input.raffleId} ${escapeTelegramHtml(input.raffleTitle)}</b>`,
      "Complete the items below, then press Retry entry.",
      "",
      ...lines,
    ].join("\n"),
    keyboard,
  };
}

export async function sendTelegramEntryRequirements(
  ctx: Context,
  input: TelegramEntryRequirements,
): Promise<boolean> {
  if (!ctx.from) return false;
  const { text, keyboard } = buildTelegramEntryRequirements(input);
  return ctx.api
    .sendMessage(ctx.from.id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    })
    .then(() => true)
    .catch(() => false);
}
