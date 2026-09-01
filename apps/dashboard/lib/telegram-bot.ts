import { Bot, type Context } from "grammy";
import type { Update } from "grammy/types";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import {
  evaluateWebGates,
  fetchGuildMember,
  recordWebEntry,
} from "@/lib/raffle-entry";
import { publishRaffleToTelegram } from "@/lib/telegram-publication";
import { telegramActorHasPermission, telegramConfig } from "@/lib/telegram";
import { isTelegramAdmin, telegramDisplayName } from "@kos/db";
import { registerTelegramCommunityHandlers } from "@/lib/telegram/community";
import { dashboardOrigin, displayTelegramError } from "@/lib/telegram/format";
import { telegramLog } from "@/lib/telegram/log";
import { registerTelegramNavigation } from "@/lib/telegram/navigation";
import { telegramRateLimitMiddleware } from "@/lib/telegram/rate-limit";

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
  if (
    !token ||
    token.action !== "TELEGRAM_ENTER" ||
    token.expiresAt <= new Date() ||
    !publication ||
    publication.community.status !== "ACTIVE" ||
    String(ctx.callbackQuery.message.chat.id) !==
      publication.community.telegramChatId
  ) {
    await answer(ctx, "This raffle button is no longer active.");
    return;
  }
  const account = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(ctx.from.id),
      },
    },
    include: { user: true },
  });
  if (!account) {
    await answer(
      ctx,
      `Connect Telegram from ${dashboardOrigin()}/me, then try again.`,
    );
    return;
  }
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      handle: ctx.from.username ?? null,
      displayName: telegramDisplayName(ctx.from),
      lastSeenAt: new Date(),
    },
  });
  if (publication.raffle.status !== "LIVE") {
    await answer(ctx, "This raffle is not open for entries.");
    return;
  }
  const existing = await prisma.participant.findUnique({
    where: {
      raffleId_userId: {
        raffleId: publication.raffle.id,
        userId: account.userId,
      },
    },
  });
  if (existing) {
    await answer(ctx, "You are already entered in this raffle.");
    return;
  }
  const report = await evaluateWebGates(account.user, publication.raffle);
  if (!report.canEnter) {
    await answer(
      ctx,
      displayTelegramError(report.gates.flatMap((gate) => gate.reason ?? [])),
    );
    return;
  }
  const discordMember = await fetchGuildMember(
    publication.raffle.guildId,
    account.userId,
  );
  if (discordMember === "not_member" || discordMember === "unavailable") {
    await answer(
      ctx,
      "KOS could not confirm your Discord membership right now.",
    );
    return;
  }
  const entryCount = await recordWebEntry(
    account.user,
    publication.raffle,
    discordMember,
    "Telegram",
  );
  await answer(
    ctx,
    entryCount === null
      ? "You are already entered in this raffle."
      : `You're in. This raffle now has ${entryCount} entries.`,
  );
}

export function buildTelegramBot(token: string): Bot {
  const bot = new Bot(token);
  bot.use(telegramRateLimitMiddleware);
  registerTelegramNavigation(bot);
  registerTelegramCommunityHandlers(bot);
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
