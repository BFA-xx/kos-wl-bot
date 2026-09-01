import { type Bot, type Context, InlineKeyboard } from "grammy";
import { telegramDisplayName } from "@kos/db";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import {
  dashboardOrigin,
  escapeTelegramHtml,
  parseTelegramStartPayload,
} from "@/lib/telegram/format";
import {
  ensureTelegramIdentity,
  linkTelegramAccount,
} from "@/lib/telegram/identity";

function mainMenuKeyboard(): InlineKeyboard {
  const origin = dashboardOrigin();
  return new InlineKeyboard()
    .text("My Profile", "nav:profile")
    .url("Raffles", `${origin}/me/raffles`)
    .row()
    .url("Points", `${origin}/me/points`)
    .url("Settings", `${origin}/me`);
}

async function render(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
  edit = false,
): Promise<void> {
  const options = {
    parse_mode: "HTML" as const,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, options).catch(async () => {
      await ctx.reply(text, options);
    });
    return;
  }
  await ctx.reply(text, options);
}

async function showMenu(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Message KOS Bot directly to open your private menu.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  if (identity.status === "SUSPENDED") {
    await ctx.reply("This KOS identity is currently unavailable.");
    return;
  }
  await render(
    ctx,
    [
      `<b>Welcome back, ${escapeTelegramHtml(telegramDisplayName(ctx.from))}.</b>`,
      "",
      "Your KOS identity connects community access, raffles, points, and future ecosystem products.",
    ].join("\n"),
    mainMenuKeyboard(),
    edit,
  );
}

async function showGettingStarted(
  ctx: Context,
  communityName?: string,
  edit = false,
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .url("Complete KOS profile", `${dashboardOrigin()}/me`)
    .row()
    .text("Open menu", "nav:menu");
  await render(
    ctx,
    [
      `<b>${communityName ? `Welcome to ${escapeTelegramHtml(communityName)}` : "Welcome to KOS"}</b>`,
      "",
      "Your Telegram identity is verified and your KOS identity is ready.",
      "Complete your profile to connect existing KOS products. A wallet is optional unless a raffle requires one.",
    ].join("\n"),
    keyboard,
    edit,
  );
}

async function showWelcome(
  ctx: Context,
  communityName?: string,
): Promise<void> {
  await render(
    ctx,
    [
      `<b>${communityName ? `Welcome to ${escapeTelegramHtml(communityName)}` : "Welcome to KOS"}</b>`,
      "",
      "Your gateway to the KOS ecosystem.",
    ].join("\n"),
    new InlineKeyboard().text("Get Started", "onboarding:start"),
  );
}

async function showProfile(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Open your KOS profile in a private chat with the bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const stats = identity.legacyUserId
    ? await Promise.all([
        prisma.pointsLedger.aggregate({
          where: { userId: identity.legacyUserId },
          _sum: { delta: true },
        }),
        prisma.participant.count({
          where: { userId: identity.legacyUserId },
        }),
        prisma.winner.count({
          where: { userId: identity.legacyUserId, replaced: false },
        }),
      ])
    : null;
  const points = stats?.[0]._sum.delta ?? 0;
  const entered = stats?.[1] ?? 0;
  const wins = stats?.[2] ?? 0;
  const keyboard = new InlineKeyboard()
    .url("Open full profile", `${dashboardOrigin()}/me`)
    .row()
    .text("Back", "nav:menu");
  await render(
    ctx,
    [
      "<b>KOS PROFILE</b>",
      "",
      `<b>${escapeTelegramHtml(identity.displayName)}</b>`,
      `KOS ID: <code>${identity.id}</code>`,
      `Profile: ${identity.legacyUserId ? "Connected" : "Telegram identity only"}`,
      "",
      `<b>Points</b>: ${points.toLocaleString("en-US")}`,
      `<b>Raffles</b>: ${entered} entered, ${wins} won`,
    ].join("\n"),
    keyboard,
    edit,
  );
}

async function showAdmin(ctx: Context): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Use /admin in a private chat with KOS Bot.");
    return;
  }
  const connected = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(ctx.from.id),
      },
    },
    select: { userId: true },
  });
  if (!connected) {
    await ctx.reply(
      "Connect Telegram from your KOS profile before using admin tools.",
      {
        reply_markup: new InlineKeyboard().url(
          "Open KOS profile",
          `${dashboardOrigin()}/me`,
        ),
      },
    );
    return;
  }
  const organizations = await prisma.organization.findMany({
    where: {
      telegramCommunities: { some: { status: "ACTIVE" } },
      OR: [
        { ownerId: connected.userId },
        {
          members: {
            some: {
              userId: connected.userId,
              status: "ACTIVE",
              role: { permissions: { has: PERMISSIONS.SETTINGS_EDIT } },
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
    select: { name: true, slug: true },
  });
  if (organizations.length === 0) {
    await ctx.reply("No Telegram community admin access is linked to you.");
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const organization of organizations.slice(0, 8)) {
    keyboard
      .url(
        `${organization.name} settings`,
        `${dashboardOrigin()}/${organization.slug}/settings`,
      )
      .row();
  }
  await render(
    ctx,
    [
      "<b>KOS ADMIN</b>",
      "",
      `Authorized communities: ${organizations.length}`,
      "Sensitive actions still require both Telegram admin status and KOS permissions.",
    ].join("\n"),
    keyboard,
  );
}

async function handleStart(ctx: Context): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply(
      "Message KOS Bot directly to create or open your identity.",
    );
    return;
  }
  const rawPayload = typeof ctx.match === "string" ? ctx.match : "";
  const payload = parseTelegramStartPayload(rawPayload);
  if (payload.kind === "invalid") {
    await ctx.reply("That KOS link is invalid or has expired.");
    return;
  }
  if (payload.kind === "link") {
    await linkTelegramAccount(ctx, payload.secret);
    return;
  }

  const identity = await ensureTelegramIdentity(ctx.from);
  if (payload.kind === "raffle") {
    const raffle = await prisma.raffle.findFirst({
      where: { id: payload.raffleId, status: { not: "CANCELLED" } },
      select: { id: true, title: true, status: true },
    });
    if (!raffle) {
      await ctx.reply("That raffle is not available.");
      return;
    }
    await render(
      ctx,
      [
        "<b>KOS RAFFLE</b>",
        "",
        escapeTelegramHtml(raffle.title),
        `Status: ${raffle.status}`,
      ].join("\n"),
      new InlineKeyboard().url(
        "View raffle",
        `${dashboardOrigin()}/r/${raffle.id}`,
      ),
    );
    return;
  }
  if (payload.kind === "invite") {
    await ctx.reply(
      "This invite format is valid, but referrals are not active yet. No reward has been recorded.",
    );
    return;
  }
  if (payload.kind === "welcome") {
    const community = await prisma.telegramCommunity.findFirst({
      where: {
        id: payload.communityId,
        status: "ACTIVE",
        featureFlags: { has: "ONBOARDING" },
      },
      select: { communityName: true },
    });
    if (!community) {
      await ctx.reply("That KOS community link is no longer active.");
      return;
    }
    await showWelcome(ctx, community.communityName);
    return;
  }
  if (payload.kind === "onboarding") {
    await showGettingStarted(ctx);
    return;
  }
  if (identity.isNew) {
    await showWelcome(ctx);
    return;
  }
  await showMenu(ctx);
}

export function registerTelegramNavigation(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("menu", (ctx) => showMenu(ctx));
  bot.command("profile", (ctx) => showProfile(ctx));
  bot.command("admin", showAdmin);
  bot.callbackQuery("nav:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });
  bot.callbackQuery("nav:profile", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfile(ctx, true);
  });
  bot.callbackQuery("onboarding:start", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showGettingStarted(ctx, undefined, true);
  });
}
