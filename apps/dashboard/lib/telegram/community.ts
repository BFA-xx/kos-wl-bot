import { type Bot, type Context, InlineKeyboard } from "grammy";
import { telegramDisplayName } from "@kos/db";
import { prisma } from "@/lib/db";
import { didTelegramMemberJoin } from "@/lib/telegram";
import {
  dashboardOrigin,
  escapeTelegramHtml,
  telegramUserMention,
} from "@/lib/telegram/format";

async function showTelegramChatId(ctx: Context): Promise<void> {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply(
      "Use this command inside the Telegram group you want to connect.",
    );
    return;
  }
  await ctx.reply(
    `Telegram chat ID: ${ctx.chat.id}\nAdd it under your KOS organization Settings.`,
  );
}

async function welcomeTelegramMember(ctx: Context): Promise<void> {
  const update = ctx.update.chat_member;
  if (
    !update ||
    !["group", "supergroup"].includes(update.chat.type) ||
    update.new_chat_member.user.is_bot ||
    !didTelegramMemberJoin(update.old_chat_member, update.new_chat_member)
  ) {
    return;
  }
  const community = await prisma.telegramCommunity.findFirst({
    where: {
      telegramChatId: String(update.chat.id),
      status: "ACTIVE",
      featureFlags: { has: "ONBOARDING" },
    },
    select: { id: true, communityName: true },
  });
  if (!community) return;

  const member = update.new_chat_member.user;
  const memberName = telegramDisplayName(member).slice(0, 80);
  const mention = telegramUserMention(member.id, memberName);
  await ctx.api.sendMessage(
    update.chat.id,
    [
      `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
      "",
      "Start KOS Bot to create your KOS identity and unlock community raffles.",
      "A wallet is only required when a specific raffle asks for one.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .url(
          "Start KOS Bot",
          `https://t.me/${ctx.me.username}?start=welcome_${community.id}`,
        )
        .row()
        .url("Open KOS", `${dashboardOrigin()}/me`),
      link_preview_options: { is_disabled: true },
    },
  );
}

export function registerTelegramCommunityHandlers(bot: Bot): void {
  bot.command("chatid", showTelegramChatId);
  bot.on("chat_member", welcomeTelegramMember);
}
