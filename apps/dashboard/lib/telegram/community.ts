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
    update.new_chat_member.user.is_bot
  ) {
    return;
  }
  const community = await prisma.telegramCommunity.findFirst({
    where: {
      telegramChatId: String(update.chat.id),
      status: "ACTIVE",
    },
    select: { id: true, communityName: true },
  });
  if (!community) return;

  const member = update.new_chat_member.user;
  const joined = didTelegramMemberJoin(
    update.old_chat_member,
    update.new_chat_member,
  );
  const activeStatuses = ["creator", "administrator", "member"];
  const status =
    update.new_chat_member.status === "kicked"
      ? "BANNED"
      : activeStatuses.includes(update.new_chat_member.status) ||
          (update.new_chat_member.status === "restricted" &&
            update.new_chat_member.is_member)
        ? "ACTIVE"
        : "LEFT";
  const account = await prisma.identityAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(member.id),
      },
    },
    select: { identityId: true },
  });
  await prisma.telegramCommunityMember.upsert({
    where: {
      communityId_telegramUserId: {
        communityId: community.id,
        telegramUserId: String(member.id),
      },
    },
    create: {
      communityId: community.id,
      telegramUserId: String(member.id),
      identityId: account?.identityId,
      status,
      leftAt: status === "ACTIVE" ? null : new Date(),
    },
    update: {
      identityId: account?.identityId,
      status,
      joinedAt: joined ? new Date() : undefined,
      leftAt: status === "ACTIVE" ? null : new Date(),
      lastSeenAt: new Date(),
    },
  });
  if (!joined) return;
  const onboardingEnabled = await prisma.telegramCommunity.count({
    where: { id: community.id, featureFlags: { has: "ONBOARDING" } },
  });
  if (!onboardingEnabled) return;
  const memberName = telegramDisplayName(member).slice(0, 80);
  const mention = telegramUserMention(member.id, memberName);
  await ctx.api.sendMessage(
    update.chat.id,
    [
      `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
      "",
      "Start KOS Bot to create your KOS identity and unlock community raffles.",
      "Finish onboarding, then a KOS team admin will approve your access.",
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

export async function attachTelegramCommunityIdentity(input: {
  communityId: string;
  telegramUserId: string;
  identityId: string;
}): Promise<void> {
  await prisma.telegramCommunityMember.upsert({
    where: {
      communityId_telegramUserId: {
        communityId: input.communityId,
        telegramUserId: input.telegramUserId,
      },
    },
    create: {
      communityId: input.communityId,
      telegramUserId: input.telegramUserId,
      identityId: input.identityId,
      status: "ACTIVE",
    },
    update: {
      identityId: input.identityId,
      status: "ACTIVE",
      leftAt: null,
      lastSeenAt: new Date(),
    },
  });
}

export function registerTelegramCommunityHandlers(bot: Bot): void {
  bot.command("chatid", showTelegramChatId);
  bot.on("chat_member", welcomeTelegramMember);
}
