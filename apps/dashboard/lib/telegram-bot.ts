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
import {
  hashIntegrationToken,
  isTelegramAdmin,
  telegramDisplayName,
} from "@kos/db";

let cachedBot: Bot | null = null;
let botInit: Promise<unknown> | null = null;

function dashboardOrigin(): string {
  const value = process.env.DASHBOARD_URL?.trim();
  if (!value) return "https://raffle.koslabs.app";
  try {
    return new URL(value).origin;
  } catch {
    return "https://raffle.koslabs.app";
  }
}

function displayError(reasons: string[]): string {
  return (reasons[0] ?? "Requirements are not complete.").slice(0, 180);
}

async function answer(ctx: Context, text: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: text.slice(0, 190), show_alert: true });
}

async function linkTelegramAccount(
  ctx: Context,
  secret: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const from = ctx.from;
  const now = new Date();
  const tokenHash = hashIntegrationToken(secret);
  const telegramUserId = String(from.id);
  const displayName = telegramDisplayName(from);

  const outcome = await prisma.$transaction(async (tx) => {
    const token = await tx.integrationActionToken.findUnique({
      where: { tokenHash },
    });
    if (
      !token ||
      token.action !== "TELEGRAM_LINK" ||
      !token.userId ||
      token.expiresAt <= now ||
      token.consumedAt
    ) {
      return "expired" as const;
    }
    const claimed = await tx.integrationActionToken.updateMany({
      where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) return "expired" as const;
    const taken = await tx.connectedAccount.findUnique({
      where: {
        provider_externalId: {
          provider: "TELEGRAM",
          externalId: telegramUserId,
        },
      },
      select: { userId: true },
    });
    if (taken && taken.userId !== token.userId) return "taken" as const;
    await tx.connectedAccount.upsert({
      where: {
        userId_provider: { userId: token.userId, provider: "TELEGRAM" },
      },
      create: {
        userId: token.userId,
        provider: "TELEGRAM",
        externalId: telegramUserId,
        handle: from.username ?? null,
        displayName,
        verifiedAt: now,
        lastSeenAt: now,
        metadata: { source: "telegram_deep_link" },
      },
      update: {
        externalId: telegramUserId,
        handle: from.username ?? null,
        displayName,
        verifiedAt: now,
        lastSeenAt: now,
      },
    });
    return "linked" as const;
  });

  if (outcome === "expired") {
    await ctx.reply(
      "This KOS linking request has expired. Start a new one from your KOS profile.",
    );
  } else if (outcome === "taken") {
    await ctx.reply(
      "This Telegram account is already linked to another KOS account.",
    );
  } else {
    await ctx.reply(
      "Telegram connected to KOS. You can now enter eligible raffles here.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open KOS profile", url: `${dashboardOrigin()}/me` }],
          ],
        },
      },
    );
  }
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
    await ctx.reply("This Telegram community is not authorized in KOS.");
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
      displayError(report.gates.flatMap((gate) => gate.reason ?? [])),
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

function buildBot(token: string): Bot {
  const bot = new Bot(token);
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";
    if (payload.startsWith("link_")) {
      await linkTelegramAccount(ctx, payload.slice(5));
      return;
    }
    await ctx.reply(
      "KOS Raffles is ready. Connect Telegram from your KOS profile to enter raffles.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open KOS profile", url: `${dashboardOrigin()}/me` }],
          ],
        },
      },
    );
  });
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
  return bot;
}

export async function handleTelegramUpdate(update: Update): Promise<void> {
  const { botToken } = telegramConfig();
  if (!botToken) throw new Error("Telegram bot is not configured");
  if (!cachedBot) {
    cachedBot = buildBot(botToken);
    botInit = cachedBot.init();
  }
  await botInit;
  await cachedBot.handleUpdate(update);
}
