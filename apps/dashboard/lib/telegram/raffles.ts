import { type Bot, type Context, InlineKeyboard } from "grammy";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requireTelegramCommunityPermission } from "@/lib/telegram/access";
import { dashboardOrigin, escapeTelegramHtml } from "@/lib/telegram/format";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";

function privateOnly(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

export async function showTelegramRaffle(
  ctx: Context,
  raffleId: number,
  edit = false,
): Promise<void> {
  if (!privateOnly(ctx)) {
    await ctx.reply("Open raffle details in a private chat with KOS Bot.");
    return;
  }
  const raffle = await prisma.raffle.findFirst({
    where: {
      id: raffleId,
      status: { not: "CANCELLED" },
      telegramPublications: {
        some: {
          community: { status: "ACTIVE", featureFlags: { has: "RAFFLES" } },
        },
      },
    },
    include: {
      telegramPublications: {
        where: {
          community: { status: "ACTIVE", featureFlags: { has: "RAFFLES" } },
        },
        include: { community: true, entryActionToken: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const publication = raffle?.telegramPublications[0];
  if (!raffle || !publication) {
    await ctx.reply("That raffle is not available in Telegram.");
    return;
  }
  const keyboard = new InlineKeyboard();
  if (
    raffle.status === "LIVE" &&
    publication.entryActionToken &&
    publication.entryActionToken.expiresAt > new Date()
  ) {
    keyboard.text("Enter raffle", `a:${publication.entryActionToken.id}`).row();
  }
  keyboard
    .url("Open raffle", `${dashboardOrigin()}/r/${raffle.id}`)
    .row()
    .text("Back to raffles", "raffles:list");
  const text = [
    `<b>${escapeTelegramHtml(raffle.title)}</b>`,
    "",
    `Raffle #${raffle.id}`,
    `Community: ${escapeTelegramHtml(publication.community.communityName)}`,
    `Status: ${raffle.status}`,
    `Winners: ${raffle.spots}`,
    `Entries: ${raffle.entryCount}`,
    `Ends: ${raffle.endAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
    raffle.requireWallet
      ? "Requirement: linked wallet"
      : "Requirement: standard KOS checks",
  ].join("\n");
  const options = {
    parse_mode: "HTML" as const,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };
  if (edit && ctx.callbackQuery?.message) {
    await ctx
      .editMessageText(text, options)
      .catch(async () => ctx.reply(text, options));
    return;
  }
  await ctx.reply(text, options);
}

async function showRaffleList(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from || !privateOnly(ctx)) {
    await ctx.reply("Use /raffles in a private chat with KOS Bot.");
    return;
  }
  await ensureTelegramIdentity(ctx.from);
  const raffles = await prisma.raffle.findMany({
    where: {
      status: { in: ["LIVE", "UPCOMING"] },
      endAt: { gt: new Date() },
      telegramPublications: {
        some: {
          community: { status: "ACTIVE", featureFlags: { has: "RAFFLES" } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { endAt: "asc" }],
    take: 10,
    select: { id: true, title: true, status: true },
  });
  const keyboard = new InlineKeyboard();
  for (const raffle of raffles) {
    keyboard
      .text(
        `${raffle.status === "LIVE" ? "LIVE" : "SOON"} #${raffle.id} ${raffle.title}`.slice(
          0,
          60,
        ),
        `raffle:view:${raffle.id}`,
      )
      .row();
  }
  keyboard.text("Back", "nav:menu");
  const text = raffles.length
    ? "Active KOS raffles"
    : "There are no active Telegram raffles right now.";
  if (edit && ctx.callbackQuery?.message) {
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(async () => ctx.reply(text, { reply_markup: keyboard }));
    return;
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

async function showEntries(ctx: Context): Promise<void> {
  if (!ctx.from || !privateOnly(ctx)) {
    await ctx.reply("Use /entries in a private chat with KOS Bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  if (!identity.legacyUserId) {
    await ctx.reply("Connect your KOS profile before viewing raffle entries.", {
      reply_markup: new InlineKeyboard().url(
        "Open KOS profile",
        `${dashboardOrigin()}/me`,
      ),
    });
    return;
  }
  const entries = await prisma.participant.findMany({
    where: { userId: identity.legacyUserId },
    include: { raffle: { select: { id: true, title: true, status: true } } },
    orderBy: { enteredAt: "desc" },
    take: 10,
  });
  await ctx.reply(
    entries.length
      ? [
          "Your latest KOS raffle entries:",
          ...entries.map(
            (entry) =>
              `#${entry.raffle.id} ${entry.raffle.title} (${entry.raffle.status})`,
          ),
        ].join("\n")
      : "You have not entered a KOS raffle yet.",
  );
}

interface QuickRafflePayload {
  title?: string;
  spots?: number;
  durationMinutes?: number;
  requireWallet?: boolean;
}

const forceReply = { force_reply: true as const, selective: true };

async function startQuickRaffle(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.RAFFLE_CREATE,
    "QUICK_RAFFLES",
  );
  if (!access || !ctx.from || !ctx.chat) return;
  await prisma.telegramConversation.upsert({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: String(ctx.chat.id),
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
    create: {
      communityId: access.community.id,
      telegramChatId: String(ctx.chat.id),
      telegramUserId: String(ctx.from.id),
      kind: "QUICK_RAFFLE",
      step: "TITLE",
      payload: {},
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
    update: {
      communityId: access.community.id,
      step: "TITLE",
      payload: {},
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  await ctx.reply(
    "Quick raffle: send the prize or raffle title (120 characters maximum).",
    { reply_markup: forceReply },
  );
}

async function cancelQuickRaffle(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  await prisma.telegramConversation.deleteMany({
    where: {
      telegramChatId: String(ctx.chat.id),
      telegramUserId: String(ctx.from.id),
      kind: "QUICK_RAFFLE",
    },
  });
  await ctx.reply("Quick raffle cancelled.");
}

async function handleQuickRaffleText(ctx: Context): Promise<void> {
  if (
    !ctx.from ||
    !ctx.chat ||
    !ctx.message?.text ||
    ctx.message.text.startsWith("/")
  )
    return;
  const conversation = await prisma.telegramConversation.findUnique({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: String(ctx.chat.id),
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
  });
  if (!conversation) return;
  if (conversation.expiresAt <= new Date()) {
    await prisma.telegramConversation.delete({
      where: { id: conversation.id },
    });
    await ctx.reply("That quick-raffle setup expired. Run /quickraffle again.");
    return;
  }
  const payload = (conversation.payload ?? {}) as QuickRafflePayload;
  const value = ctx.message.text.trim();
  if (conversation.step === "TITLE") {
    if (!value || value.length > 120) {
      await ctx.reply("Send a title between 1 and 120 characters.", {
        reply_markup: forceReply,
      });
      return;
    }
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: {
        step: "SPOTS",
        payload: { ...payload, title: value } as Prisma.InputJsonValue,
      },
    });
    await ctx.reply("How many winners? Send a number from 1 to 100.", {
      reply_markup: forceReply,
    });
    return;
  }
  if (conversation.step === "SPOTS") {
    const spots = /^\d{1,3}$/u.test(value) ? Number(value) : 0;
    if (spots < 1 || spots > 100) {
      await ctx.reply("Send a winner count from 1 to 100.", {
        reply_markup: forceReply,
      });
      return;
    }
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: {
        step: "DURATION",
        payload: { ...payload, spots } as Prisma.InputJsonValue,
      },
    });
    await ctx.reply(
      "How many minutes should entries stay open? Send 5 to 10080.",
      { reply_markup: forceReply },
    );
    return;
  }
  if (conversation.step === "DURATION") {
    const durationMinutes = /^\d{1,5}$/u.test(value) ? Number(value) : 0;
    if (durationMinutes < 5 || durationMinutes > 10_080) {
      await ctx.reply("Send a duration from 5 to 10080 minutes.", {
        reply_markup: forceReply,
      });
      return;
    }
    await prisma.telegramConversation.update({
      where: { id: conversation.id },
      data: {
        step: "REQUIREMENT",
        payload: { ...payload, durationMinutes } as Prisma.InputJsonValue,
      },
    });
    await ctx.reply("Choose an entry requirement.", {
      reply_markup: new InlineKeyboard()
        .text("Standard", "quick:req:standard")
        .text("Linked wallet", "quick:req:wallet")
        .row()
        .text("Cancel", "quick:cancel"),
    });
  }
}

async function chooseQuickRequirement(
  ctx: Context,
  requireWallet: boolean,
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const conversation = await prisma.telegramConversation.findUnique({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: String(ctx.chat.id),
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
  });
  if (
    !conversation ||
    conversation.step !== "REQUIREMENT" ||
    conversation.expiresAt <= new Date()
  ) {
    await ctx.answerCallbackQuery({
      text: "This setup expired.",
      show_alert: true,
    });
    return;
  }
  const payload = {
    ...(conversation.payload as QuickRafflePayload),
    requireWallet,
  };
  await prisma.telegramConversation.update({
    where: { id: conversation.id },
    data: { step: "CONFIRM", payload: payload as Prisma.InputJsonValue },
  });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    [
      "Confirm quick raffle:",
      `Title: ${payload.title}`,
      `Winners: ${payload.spots}`,
      `Duration: ${payload.durationMinutes} minutes`,
      `Requirement: ${requireWallet ? "linked wallet" : "standard"}`,
    ].join("\n"),
    {
      reply_markup: new InlineKeyboard()
        .text("Create", "quick:confirm")
        .text("Cancel", "quick:cancel"),
    },
  );
}

async function confirmQuickRaffle(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.RAFFLE_CREATE,
    "QUICK_RAFFLES",
  );
  if (!access) return;
  const conversation = await prisma.telegramConversation.findUnique({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: String(ctx.chat.id),
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
  });
  if (
    !conversation ||
    conversation.step !== "CONFIRM" ||
    conversation.expiresAt <= new Date()
  ) {
    await ctx.answerCallbackQuery({
      text: "This setup expired.",
      show_alert: true,
    });
    return;
  }
  const payload = conversation.payload as QuickRafflePayload;
  if (!payload.title || !payload.spots || !payload.durationMinutes) {
    await ctx.answerCallbackQuery({
      text: "This setup is incomplete.",
      show_alert: true,
    });
    return;
  }
  const title = payload.title;
  const spots = payload.spots;
  const durationMinutes = payload.durationMinutes;
  const guild = await prisma.guild.findUnique({
    where: { id: access.community.backingGuildId },
  });
  if (!guild?.defaultRaffleChannelId) {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Set a default raffle channel in KOS before creating a quick raffle.",
    );
    return;
  }
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: access.userId },
  });
  const now = new Date();
  const raffle = await prisma.$transaction(async (tx) => {
    const created = await tx.raffle.create({
      data: {
        guildId: guild.id,
        channelId: guild.defaultRaffleChannelId,
        announceChannelId: guild.defaultAnnounceChannelId,
        proofChannelId: guild.defaultProofChannelId,
        projectName: access.community.communityName,
        title,
        description: "Created with KOS Bot quick raffle.",
        spots,
        status: "DRAFT",
        startAt: now,
        endAt: new Date(now.getTime() + durationMinutes * 60_000),
        startPing: "none",
        requireWallet: payload.requireWallet === true,
        collectWallets: payload.requireWallet === true,
        walletChains: ["ETHEREUM"],
        createdById: actor.id,
        createdByName: actor.globalName ?? actor.username,
        createdByAvatar: actor.avatarUrl,
      },
    });
    await tx.telegramConversation.delete({ where: { id: conversation.id } });
    await tx.auditLog.create({
      data: {
        organizationId: access.community.organizationId,
        actorId: actor.id,
        action: "TELEGRAM_QUICK_RAFFLE_CREATE",
        targetType: "raffle",
        targetId: String(created.id),
        metadata: { telegramChatId: String(ctx.chat!.id), durationMinutes },
      },
    });
    return created;
  });
  await ctx.answerCallbackQuery({ text: `Raffle #${raffle.id} created.` });
  await ctx.editMessageText(
    `Quick raffle #${raffle.id} is queued. KOS will publish it to Discord and Telegram.`,
  );
}

export function registerTelegramRaffleHandlers(bot: Bot): void {
  bot.command("raffles", (ctx) => showRaffleList(ctx));
  bot.command("entries", showEntries);
  bot.command("quickraffle", startQuickRaffle);
  bot.command("cancel", cancelQuickRaffle);
  bot.callbackQuery("raffles:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRaffleList(ctx, true);
  });
  bot.callbackQuery(/^raffle:view:(\d{1,10})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    const raffleId = Number(ctx.match[1]);
    if (Number.isSafeInteger(raffleId) && raffleId > 0)
      await showTelegramRaffle(ctx, raffleId, true);
  });
  bot.callbackQuery(/^quick:req:(standard|wallet)$/u, (ctx) =>
    chooseQuickRequirement(ctx, ctx.match[1] === "wallet"),
  );
  bot.callbackQuery("quick:confirm", confirmQuickRaffle);
  bot.callbackQuery("quick:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await cancelQuickRaffle(ctx);
    await ctx.deleteMessage().catch(() => undefined);
  });
  bot.on("message:text", handleQuickRaffleText);
}
