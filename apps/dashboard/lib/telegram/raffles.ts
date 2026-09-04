import {
  type Bot,
  type Context,
  InlineKeyboard,
  type NextFunction,
} from "grammy";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { editOrReply } from "@/lib/telegram/edit-or-reply";
import { PERMISSIONS } from "@/lib/permissions";
import {
  findPrivateTelegramCommunityAccesses,
  requirePrivateTelegramCommunityPermission,
  requireTelegramCommunityPermission,
  type TelegramCommunityAccess,
} from "@/lib/telegram/access";
import {
  dashboardOrigin,
  escapeTelegramHtml,
  telegramCountdown,
} from "@/lib/telegram/format";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { removeWebEntry } from "@/lib/raffle-entry";
import {
  evaluateTelegramRaffleAccess,
  renderAccessChecklist,
} from "@/lib/telegram/raffle-access";

function privateOnly(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

const PAGE_SIZE = 8;

const LIVE_PUBLICATION = {
  community: { status: "ACTIVE", featureFlags: { has: "RAFFLES" } },
} as const;

export async function showTelegramRaffle(
  ctx: Context,
  raffleId: number,
  edit = false,
): Promise<void> {
  if (!ctx.from || !privateOnly(ctx)) {
    await ctx.reply("Open raffle details in a private chat with KOS Bot.");
    return;
  }
  const raffle = await prisma.raffle.findFirst({
    where: {
      id: raffleId,
      status: { not: "CANCELLED" },
      telegramPublications: { some: LIVE_PUBLICATION },
    },
    include: {
      eligibleRoles: true,
      telegramPublications: {
        where: LIVE_PUBLICATION,
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

  const identity = await ensureTelegramIdentity(ctx.from);
  const access = await evaluateTelegramRaffleAccess(
    ctx,
    ctx.from,
    identity.id,
    publication.community,
    raffle,
  );

  const keyboard = new InlineKeyboard();
  const tokenLive =
    publication.entryActionToken &&
    publication.entryActionToken.expiresAt > new Date();

  if (access.alreadyEntered) {
    keyboard.text("Leave raffle", `raffle:leave:${raffle.id}`).row();
  } else if (access.canEnter && tokenLive && publication.entryActionToken) {
    keyboard.text("Enter raffle", `a:${publication.entryActionToken.id}`).row();
  } else if (access.canEnter && !tokenLive) {
    // Everything passes but the group's entry token has expired — the website
    // is still a working way in, so say so rather than showing nothing.
    keyboard
      .url("Enter on the website", `${dashboardOrigin()}/r/${raffle.id}`)
      .row();
  } else if (access.actionUrl) {
    keyboard
      .url(
        access.block === "not_linked" ? "Connect KOS profile" : "Fix this",
        access.actionUrl,
      )
      .row();
  } else if (access.block === "approval_pending") {
    keyboard.text("Check access status", "nav:status").row();
  }

  keyboard
    .url("Open raffle", `${dashboardOrigin()}/r/${raffle.id}`)
    .row()
    .text("Back to raffles", "raffles:list");

  const closes = raffle.status === "UPCOMING" ? raffle.startAt : raffle.endAt;
  const text = [
    `<b>${escapeTelegramHtml(raffle.title)}</b>`,
    "",
    `Raffle #${raffle.id} · ${escapeTelegramHtml(publication.community.communityName)}`,
    `${raffle.status === "UPCOMING" ? "Opens" : "Ends"} ${escapeTelegramHtml(telegramCountdown(closes))}`,
    `${raffle.spots} winner${raffle.spots === 1 ? "" : "s"} · ${raffle.entryCount} ${raffle.entryCount === 1 ? "entry" : "entries"}`,
    "",
    access.alreadyEntered
      ? "<b>You are entered.</b>"
      : "<b>Your eligibility</b>",
    ...renderAccessChecklist(access, escapeTelegramHtml),
  ].join("\n");

  const options = {
    parse_mode: "HTML" as const,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };
  await editOrReply(ctx, text, options, edit);
}

async function leaveTelegramRaffle(
  ctx: Context,
  raffleId: number,
): Promise<void> {
  if (!ctx.from || !privateOnly(ctx)) return;
  const raffle = await prisma.raffle.findFirst({
    where: { id: raffleId, telegramPublications: { some: LIVE_PUBLICATION } },
    select: { id: true, guildId: true, status: true },
  });
  if (!raffle) {
    await ctx.answerCallbackQuery({
      text: "That raffle is not available in Telegram.",
      show_alert: true,
    });
    return;
  }
  if (raffle.status !== "LIVE") {
    await ctx.answerCallbackQuery({
      text: "This raffle is closed — entries are locked.",
      show_alert: true,
    });
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
    await ctx.answerCallbackQuery({
      text: "Connect your KOS profile first.",
      show_alert: true,
    });
    return;
  }
  const outcome = await removeWebEntry(account.user, raffle, "Telegram");
  await ctx.answerCallbackQuery({
    text:
      outcome === "removed"
        ? "You have left this raffle."
        : "You were not entered in this raffle.",
  });
  await showTelegramRaffle(ctx, raffleId, true);
}

async function showRaffleList(
  ctx: Context,
  edit = false,
  page = 0,
): Promise<void> {
  if (!ctx.from || !privateOnly(ctx)) {
    await ctx.reply("Use /raffles in a private chat with KOS Bot.");
    return;
  }
  await ensureTelegramIdentity(ctx.from);
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 0;
  const raffles = await prisma.raffle.findMany({
    where: {
      status: { in: ["LIVE", "UPCOMING"] },
      endAt: { gt: new Date() },
      telegramPublications: { some: LIVE_PUBLICATION },
    },
    orderBy: [{ status: "asc" }, { endAt: "asc" }],
    skip: safePage * PAGE_SIZE,
    // One extra row tells us whether a next page exists without a count query.
    take: PAGE_SIZE + 1,
    select: { id: true, title: true, status: true, endAt: true, startAt: true },
  });
  const visible = raffles.slice(0, PAGE_SIZE);
  const hasNext = raffles.length > PAGE_SIZE;

  const keyboard = new InlineKeyboard();
  for (const raffle of visible) {
    const when = telegramCountdown(
      raffle.status === "UPCOMING" ? raffle.startAt : raffle.endAt,
    );
    keyboard
      .text(
        `${raffle.status === "LIVE" ? "LIVE" : "SOON"} #${raffle.id} ${raffle.title} · ${when}`.slice(
          0,
          60,
        ),
        `raffle:view:${raffle.id}`,
      )
      .row();
  }
  if (safePage > 0 || hasNext) {
    if (safePage > 0) keyboard.text("Previous", `raffles:page:${safePage - 1}`);
    if (hasNext) keyboard.text("Next", `raffles:page:${safePage + 1}`);
    keyboard.row();
  }
  keyboard.text("Back", "nav:menu");

  const text = visible.length
    ? safePage > 0
      ? `Active KOS raffles — page ${safePage + 1}`
      : "Active KOS raffles"
    : safePage > 0
      ? "No more raffles on this page."
      : "There are no active Telegram raffles right now.";
  await editOrReply(ctx, text, { reply_markup: keyboard }, edit);
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
  if (!entries.length) {
    await ctx.reply("You have not entered a KOS raffle yet.", {
      reply_markup: new InlineKeyboard().text("Browse raffles", "raffles:list"),
    });
    return;
  }

  // Whether they actually won was previously invisible in Telegram.
  const wins = await prisma.winner.findMany({
    where: {
      userId: identity.legacyUserId,
      replaced: false,
      raffleId: { in: entries.map((entry) => entry.raffle.id) },
    },
    select: { raffleId: true },
  });
  const won = new Set(wins.map((win) => win.raffleId));

  const keyboard = new InlineKeyboard();
  for (const entry of entries.slice(0, 5)) {
    keyboard
      .text(
        `#${entry.raffle.id} ${entry.raffle.title}`.slice(0, 60),
        `raffle:view:${entry.raffle.id}`,
      )
      .row();
  }
  keyboard.text("Back", "nav:menu");

  await ctx.reply(
    [
      "<b>Your latest KOS raffle entries</b>",
      "",
      ...entries.map((entry) => {
        const outcome = won.has(entry.raffle.id)
          ? "🏆 won"
          : entry.raffle.status === "ENDED"
            ? "not selected"
            : entry.raffle.status.toLowerCase();
        return `#${entry.raffle.id} ${escapeTelegramHtml(entry.raffle.title)} — ${outcome}`;
      }),
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    },
  );
}

interface QuickRafflePayload {
  title?: string;
  spots?: number;
  durationMinutes?: number;
  requireWallet?: boolean;
}

const forceReply = { force_reply: true as const, selective: true };

async function beginQuickRaffle(
  ctx: Context,
  access: TelegramCommunityAccess,
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const privateChatId = String(ctx.from.id);
  await prisma.telegramConversation.upsert({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: privateChatId,
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
    create: {
      communityId: access.community.id,
      telegramChatId: privateChatId,
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
  const sent = await ctx.api
    .sendMessage(
      ctx.from.id,
      `Quick raffle for ${access.community.communityName}: send the prize or raffle title (120 characters maximum).`,
      { reply_markup: forceReply },
    )
    .catch(() => null);
  if (!sent) {
    await prisma.telegramConversation.deleteMany({
      where: {
        telegramChatId: privateChatId,
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    });
  }
}

async function startQuickRaffle(ctx: Context): Promise<void> {
  if (ctx.chat?.type === "private") {
    const accesses = await findPrivateTelegramCommunityAccesses(
      ctx,
      PERMISSIONS.RAFFLE_CREATE,
      "QUICK_RAFFLES",
    );
    if (accesses.length === 1) {
      await beginQuickRaffle(ctx, accesses[0]);
      return;
    }
    if (accesses.length > 1) {
      const keyboard = new InlineKeyboard();
      for (const { community } of accesses) {
        keyboard
          .text(
            community.communityName.slice(0, 60),
            `quick:start:${community.id}`,
          )
          .row();
      }
      await ctx.reply("Choose a community for this quick raffle.", {
        reply_markup: keyboard,
      });
    }
    return;
  }
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.RAFFLE_CREATE,
    "QUICK_RAFFLES",
  );
  if (!access) return;
  await ctx.deleteMessage().catch(() => undefined);
  await beginQuickRaffle(ctx, access);
}

async function cancelQuickRaffle(ctx: Context): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  if (!privateOnly(ctx)) {
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }
  await prisma.telegramConversation.deleteMany({
    where: {
      telegramChatId: String(ctx.chat.id),
      telegramUserId: String(ctx.from.id),
      kind: "QUICK_RAFFLE",
    },
  });
  await ctx.reply("Quick raffle cancelled.");
}

/**
 * Consumes replies to a running quick-raffle prompt.
 *
 * This is a `message:text` catch-all, so it MUST call `next()` on every path
 * where it does not handle the message — otherwise it halts grammY's
 * middleware chain and silently swallows every handler registered after it.
 * That is exactly how `/raffletopic` went dead in production.
 */
async function handleQuickRaffleText(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  if (
    !ctx.from ||
    !ctx.chat ||
    !privateOnly(ctx) ||
    !ctx.message?.text ||
    ctx.message.text.startsWith("/")
  ) {
    await next();
    return;
  }
  const conversation = await prisma.telegramConversation.findUnique({
    where: {
      telegramChatId_telegramUserId_kind: {
        telegramChatId: String(ctx.chat.id),
        telegramUserId: String(ctx.from.id),
        kind: "QUICK_RAFFLE",
      },
    },
  });
  if (!conversation) {
    await next();
    return;
  }
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
  if (!ctx.from || !ctx.chat || !privateOnly(ctx)) return;
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
  if (!ctx.from || !ctx.chat || !privateOnly(ctx)) return;
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
  const access = await requirePrivateTelegramCommunityPermission(
    ctx,
    conversation.communityId,
    PERMISSIONS.RAFFLE_CREATE,
    "QUICK_RAFFLES",
  );
  if (!access) {
    await ctx
      .answerCallbackQuery({ text: "Not authorized." })
      .catch(() => undefined);
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
        metadata: {
          telegramChatId: access.community.telegramChatId,
          durationMinutes,
        },
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
  bot.callbackQuery(/^raffles:page:(\d{1,3})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRaffleList(ctx, true, Number(ctx.match[1]));
  });
  bot.callbackQuery(/^raffle:leave:(\d{1,10})$/u, async (ctx) => {
    const raffleId = Number(ctx.match[1]);
    if (Number.isSafeInteger(raffleId) && raffleId > 0)
      await leaveTelegramRaffle(ctx, raffleId);
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
  bot.callbackQuery(/^quick:start:([a-z0-9]{20,36})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await requirePrivateTelegramCommunityPermission(
      ctx,
      ctx.match[1],
      PERMISSIONS.RAFFLE_CREATE,
      "QUICK_RAFFLES",
    );
    if (!access) return;
    await ctx.deleteMessage().catch(() => undefined);
    await beginQuickRaffle(ctx, access);
  });
  bot.callbackQuery("quick:confirm", confirmQuickRaffle);
  bot.callbackQuery("quick:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await cancelQuickRaffle(ctx);
    await ctx.deleteMessage().catch(() => undefined);
  });
  bot.on("message:text", handleQuickRaffleText);
}
