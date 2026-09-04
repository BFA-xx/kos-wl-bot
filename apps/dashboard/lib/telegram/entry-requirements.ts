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

function safeTelegramUrl(value: string): string | null {
  try {
    const url = new URL(value, dashboardOrigin());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isXUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "x.com" ||
    hostname.endsWith(".x.com") ||
    hostname === "twitter.com" ||
    hostname.endsWith(".twitter.com")
  );
}

function taskActionLabel(label: string, url: string): string {
  const prefix = isXUrl(url) ? "Open on X: " : "Open: ";
  return `${prefix}${label}`.slice(0, 64);
}

export function buildTelegramEntryRequirements(
  input: TelegramEntryRequirements,
): { text: string; keyboard: InlineKeyboard } {
  const failed = input.gates.filter(({ ok }) => !ok);
  const lines = failed.slice(0, 12).flatMap((gate, index) => {
    const actionUrl = gate.actionUrl ? safeTelegramUrl(gate.actionUrl) : null;
    const instruction = actionUrl
      ? `<a href="${escapeTelegramHtml(actionUrl)}">${isXUrl(actionUrl) ? "Open this task on X" : "Open this task"}</a>, complete it, then verify it in KOS.`
      : escapeTelegramHtml(
          (gate.reason ?? "Complete this requirement before entering.").slice(
            0,
            240,
          ),
        );
    return [
      `${index + 1}. <b>${escapeTelegramHtml(gate.label.slice(0, 160))}</b>`,
      instruction,
    ];
  });
  if (failed.length > 12) {
    lines.push(`And ${failed.length - 12} more requirement(s).`);
  }
  if (input.discordOnly) {
    lines.push("", "This raffle also has a Discord-only requirement.");
  }

  const keyboard = new InlineKeyboard();
  for (const gate of failed.slice(0, 12)) {
    if (!gate.actionUrl) continue;
    const url = safeTelegramUrl(gate.actionUrl);
    if (!url) continue;
    keyboard.url(taskActionLabel(gate.label, url), url).row();
  }

  const seenUrls = new Set<string>();
  for (const gate of failed) {
    if (!gate.url) continue;
    const url = safeTelegramUrl(gate.url);
    if (!url) continue;
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
