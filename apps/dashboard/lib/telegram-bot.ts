import { Bot, type Context } from "grammy";
import type { Update } from "grammy/types";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { recordWebEntry } from "@/lib/raffle-entry";
import { publishRaffleToTelegram } from "@/lib/telegram-publication";
import { telegramActorHasPermission, telegramConfig } from "@/lib/telegram";
import { isTelegramAdmin, telegramDisplayName } from "@kos/db";
import { registerTelegramCommunityHandlers } from "@/lib/telegram/community";
import { telegramLog } from "@/lib/telegram/log";
import { registerTelegramNavigation } from "@/lib/telegram/navigation";
import { telegramRateLimitMiddleware } from "@/lib/telegram/rate-limit";
import { registerTelegramNotificationHandlers } from "@/lib/telegram/notifications";
import { registerTelegramAdminHandlers } from "@/lib/telegram/admin";
import { registerTelegramRaffleHandlers } from "@/lib/telegram/raffles";
import { registerTelegramRaffleTopicHandlers } from "@/lib/telegram/raffle-topic";
import { evaluateTelegramRaffleAccess } from "@/lib/telegram/raffle-access";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { awardKosPoints } from "@/lib/telegram/points";
import { registerTelegramEngagementHandlers } from "@/lib/telegram/engagement";

let cachedBot: Bot | null = null;
let botInit: Promise<unknown> | null = null;

async function answer(ctx: Context, text: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: text.slice(0, 190), show_alert: true });
}

async function publishFromTelegram(ctx: Context, rawId: string): Promise<void> {
  if (
    !ctx.from ||
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    await ctx.reply("Use this command in an authorized Telegram community.");
    return;
  }
  const raffleId = /^\d+$/u.test(rawId) ? Number(rawId) : 0;
  if (!Number.isSafeInteger(raffleId) || raffleId < 1) {
    await ctx.reply("Usage: /raffle publish <raffle-id>");
    return;
  }
  const community = await prisma.telegramCommunity.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
  });
  if (!community || community.status !== "ACTIVE") {
    await ctx.reply(
      `This Telegram community is not authorized in KOS.\n\nChat ID: ${ctx.chat.id}\nAdd it under your KOS organization Settings.`,
    );
    return;
  }
  const member = await ctx.api
    .getChatMember(ctx.chat.id, ctx.from.id)
    .catch(() => null);
  if (!member || !isTelegramAdmin(member)) {
    await ctx.reply(
      "Only a current Telegram administrator can publish raffles.",
    );
    return;
  }
  const access = await telegramActorHasPermission({
    telegramUserId: String(ctx.from.id),
    organizationId: community.organizationId,
    permission: PERMISSIONS.RAFFLE_EDIT,
  });
  if (!access.ok) {
    await ctx.reply(access.reason);
    return;
  }
  const raffle = await prisma.raffle.findFirst({
    where: {
      id: raffleId,
      guildId: community.backingGuildId,
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  if (!raffle) {
    await ctx.reply("That raffle is not available for this community.");
    return;
  }
  const defaults = (community.defaultRaffleSettings ?? {}) as {
    membershipRequired?: boolean;
    remainUntilEnd?: boolean;
    autoAnnouncements?: boolean;
    winnerVisibility?: "PUBLIC" | "ANONYMOUS" | "ADMIN_ONLY";
  };
  const publication = await publishRaffleToTelegram({
    raffleId,
    communityId: community.id,
    actorId: access.userId,
    membershipRequired: defaults.membershipRequired === true,
    remainUntilEnd: defaults.remainUntilEnd === true,
    autoAnnouncements: defaults.autoAnnouncements !== false,
    winnerVisibility: defaults.winnerVisibility ?? "PUBLIC",
  });
  await prisma.auditLog.create({
    data: {
      organizationId: community.organizationId,
      actorId: access.userId,
      action: "TELEGRAM_RAFFLE_PUBLISH",
      targetType: "raffle",
      targetId: String(raffleId),
      metadata: {
        platform: "TELEGRAM",
        telegramUserId: String(ctx.from.id),
        telegramChatId: String(ctx.chat.id),
        publicationId: publication.id,
      },
    },
  });
  await ctx.reply(`Raffle #${raffleId} is queued for Telegram publication.`);
}

async function enterFromTelegram(ctx: Context, tokenId: string): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.message) return;
  const token = await prisma.integrationActionToken.findUnique({
    where: { id: tokenId },
    include: {
      publication: {
        include: {
          community: true,
          raffle: { include: { eligibleRoles: true } },
        },
      },
    },
  });
  const publication = token?.publication;
  const callbackChat = ctx.callbackQuery.message.chat;
  const isPrivateCallback = callbackChat.type === "private";
  if (
    !token ||
    token.action !== "TELEGRAM_ENTER" ||
    token.expiresAt <= new Date() ||
    !publication ||
    publication.community.status !== "ACTIVE" ||
    (!isPrivateCallback &&
      String(callbackChat.id) !== publication.community.telegramChatId)
  ) {
    await answer(ctx, "This raffle button is no longer active.");
    return;
  }

  const identity = await ensureTelegramIdentity(ctx.from);
  const access = await evaluateTelegramRaffleAccess(
    ctx,
    ctx.from,
    identity.id,
    publication.community,
    publication.raffle,
  );
  if (access.alreadyEntered) {
    await answer(ctx, "You are already entered in this raffle.");
    return;
  }
  if (!access.canEnter || !access.ready) {
    await answer(ctx, access.message ?? "You cannot enter this raffle yet.");
    return;
  }

  await prisma.connectedAccount.update({
    where: { id: access.ready.accountId },
    data: {
      handle: ctx.from.username ?? null,
      displayName: telegramDisplayName(ctx.from),
      lastSeenAt: new Date(),
    },
  });

  const entryCount = await recordWebEntry(
    access.ready.user,
    publication.raffle,
    access.ready.member,
    "Telegram",
  );
  if (entryCount !== null) {
    await awardKosPoints({
      identityId: identity.id,
      event: "RAFFLE_ENTERED",
      reason: `Entered KOS raffle #${publication.raffle.id}`,
      source: "kos_raffle",
      referenceId: String(publication.raffle.id),
    });
  }
  await answer(
    ctx,
    entryCount === null
      ? "You are already entered in this raffle."
      : `You're in. This raffle now has ${entryCount} entries.`,
  );
}

export function buildTelegramBot(token: string): Bot {
  const bot = new Bot(token);
  registerTelegramEngagementHandlers(bot);
  bot.use(telegramRateLimitMiddleware);
  registerTelegramNavigation(bot);
  registerTelegramCommunityHandlers(bot);
  registerTelegramNotificationHandlers(bot);
  registerTelegramAdminHandlers(bot);
  bot.command("raffle", async (ctx) => {
    const match = (ctx.match ?? "").trim().match(/^publish\s+(\d+)$/iu);
    if (!match) {
      await ctx.reply("Usage: /raffle publish <raffle-id>");
      return;
    }
    await publishFromTelegram(ctx, match[1]);
  });
  bot.callbackQuery(/^a:([A-Za-z0-9_-]+)$/u, async (ctx) => {
    await enterFromTelegram(ctx, ctx.match[1]);
  });
  // Before registerTelegramRaffleHandlers: that one ends with a
  // `message:text` catch-all, and command handlers must be reachable.
  registerTelegramRaffleTopicHandlers(bot);
  registerTelegramRaffleHandlers(bot);
  bot.catch((error) => {
    telegramLog("error", "handler_failed", {
      requestId: `tg:${error.ctx.update.update_id}`,
      updateId: error.ctx.update.update_id,
      telegramUserId: error.ctx.from ? String(error.ctx.from.id) : null,
      chatId: error.ctx.chat ? String(error.ctx.chat.id) : null,
      error:
        error.error instanceof Error
          ? error.error.message.slice(0, 500)
          : "Unknown error",
    });
    throw error.error;
  });
  return bot;
}

export async function handleTelegramUpdate(update: Update): Promise<void> {
  const { botToken } = telegramConfig();
  if (!botToken) throw new Error("Telegram bot is not configured");
  if (!cachedBot) {
    cachedBot = buildTelegramBot(botToken);
    botInit = cachedBot.init();
  }
  await botInit;
  await cachedBot.handleUpdate(update);
}
