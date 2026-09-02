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
import { completeTelegramOnboarding } from "@/lib/telegram/onboarding";
import {
  getKosLeaderboard,
  getKosPointsSummary,
  type LeaderboardPeriod,
} from "@/lib/telegram/points";
import { ensureReferralCode, recordReferral } from "@/lib/telegram/referrals";
import { showTelegramRaffle } from "@/lib/telegram/raffles";
import { attachTelegramCommunityIdentity } from "@/lib/telegram/community";

function mainMenuKeyboard(): InlineKeyboard {
  const origin = dashboardOrigin();
  return new InlineKeyboard()
    .text("My Profile", "nav:profile")
    .text("Raffles", "raffles:list")
    .row()
    .text("Points", "nav:points")
    .text("Notifications", "nav:notifications")
    .row()
    .text("Access status", "nav:status")
    .text("Invite", "nav:invite")
    .row()
    .url("KOS Settings", `${origin}/me`);
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
    .text("Complete onboarding", "onboarding:complete")
    .row()
    .url("Connect KOS profile", `${dashboardOrigin()}/me`)
    .url("Add wallet", `${dashboardOrigin()}/me/wallets`)
    .row()
    .text("Open menu", "nav:menu");
  await render(
    ctx,
    [
      `<b>${communityName ? `Welcome to ${escapeTelegramHtml(communityName)}` : "Welcome to KOS"}</b>`,
      "",
      "Your Telegram identity is verified and your KOS identity is ready.",
      "Finish onboarding now, then a KOS team admin will review your community access request.",
      "Connecting an existing KOS profile and wallet remains optional unless a raffle requires it.",
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
  const [kosPoints, stats] = await Promise.all([
    getKosPointsSummary(identity.id),
    identity.legacyUserId
      ? Promise.all([
          prisma.participant.count({
            where: { userId: identity.legacyUserId },
          }),
          prisma.winner.count({
            where: { userId: identity.legacyUserId, replaced: false },
          }),
        ])
      : null,
  ]);
  const entered = stats?.[0] ?? 0;
  const wins = stats?.[1] ?? 0;
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
      `<b>KOS Points</b>: ${kosPoints.points.toLocaleString("en-US")}`,
      `<b>Level</b>: ${kosPoints.level ? `${kosPoints.level.level} - ${escapeTelegramHtml(kosPoints.level.name)}` : "Unranked"}`,
      `<b>Raffles</b>: ${entered} entered, ${wins} won`,
    ].join("\n"),
    keyboard,
    edit,
  );
}

async function showPoints(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Use /points in a private chat with KOS Bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const summary = await getKosPointsSummary(identity.id);
  const progress = summary.nextLevel
    ? `${Math.max(0, summary.nextLevel.minPoints - summary.points)} points to ${summary.nextLevel.name}`
    : "Highest configured level reached";
  const keyboard = new InlineKeyboard()
    .text("Weekly leaderboard", "leaderboard:week")
    .row()
    .text("Monthly leaderboard", "leaderboard:month")
    .text("All time", "leaderboard:all")
    .row()
    .text("Back", "nav:menu");
  await render(
    ctx,
    [
      "<b>KOS POINTS</b>",
      "",
      `Balance: <b>${summary.points.toLocaleString("en-US")}</b>`,
      `Level: ${summary.level ? `${summary.level.level} - ${escapeTelegramHtml(summary.level.name)}` : "Unranked"}`,
      progress,
    ].join("\n"),
    keyboard,
    edit,
  );
}

async function showLeaderboard(
  ctx: Context,
  period: LeaderboardPeriod,
  edit = false,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Use /leaderboard in a private chat with KOS Bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const board = await getKosLeaderboard(period, identity.id);
  const lines = board.leaders.map(
    (entry, index) =>
      `${index + 1}. ${escapeTelegramHtml(entry.displayName)} - ${entry.points.toLocaleString("en-US")}`,
  );
  await render(
    ctx,
    [
      `<b>KOS LEADERBOARD - ${period.toUpperCase()}</b>`,
      "",
      ...(lines.length ? lines : ["No point activity in this period yet."]),
      "",
      board.requesterRank
        ? `Your rank: #${board.requesterRank} (${board.requesterPoints.toLocaleString("en-US")})`
        : "Your rank: not ranked in this period",
    ].join("\n"),
    new InlineKeyboard()
      .text("Week", "leaderboard:week")
      .text("Month", "leaderboard:month")
      .text("All", "leaderboard:all")
      .row()
      .text("Back", "nav:points"),
    edit,
  );
}

async function showInvite(ctx: Context): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Use /invite in a private chat with KOS Bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const approved = await prisma.telegramCommunityMember.count({
    where: { identityId: identity.id, approvalStatus: "APPROVED" },
  });
  if (!approved) {
    await ctx.reply("Your KOS community access must be approved before you can create invites.");
    return;
  }
  const code = await ensureReferralCode(identity.id);
  const url = `https://t.me/${ctx.me.username}?start=invite_${code}`;
  await ctx.reply(
    [
      "Invite someone to KOS with your personal link:",
      url,
      "",
      "The referral completes only after the new member finishes onboarding.",
    ].join("\n"),
    {
      reply_markup: new InlineKeyboard().url(
        "Share invite",
        `https://t.me/share/url?url=${encodeURIComponent(url)}`,
      ),
    },
  );
}

async function showAccessStatus(ctx: Context, edit = false): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Use /status in a private chat with KOS Bot.");
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const memberships = await prisma.telegramCommunityMember.findMany({
    where: { identityId: identity.id },
    include: { community: { select: { communityName: true } } },
    orderBy: { requestedAt: "desc" },
  });
  const lines = memberships.map(
    (member) =>
      `${escapeTelegramHtml(member.community.communityName)}: ${member.approvalStatus}`,
  );
  await render(
    ctx,
    [
      "<b>KOS ACCESS</b>",
      "",
      `Onboarding: ${identity.onboardingStatus}`,
      ...(lines.length
        ? lines
        : [
            "No community access request yet. Start KOS Bot from a connected community welcome link.",
          ]),
    ].join("\n"),
    new InlineKeyboard().text("Back", "nav:menu"),
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
    await showTelegramRaffle(ctx, payload.raffleId);
    return;
  }
  if (payload.kind === "invite") {
    const outcome = await recordReferral(identity.id, payload.code);
    if (outcome === "invalid") await ctx.reply("That KOS invite is not valid.");
    else if (outcome === "self")
      await ctx.reply("You cannot use your own KOS invite.");
    else if (outcome === "recorded")
      await ctx.reply("Invite accepted. Complete onboarding to activate it.");
    else await ctx.reply("Your KOS invite is already recorded.");
    await showWelcome(ctx);
    return;
  }
  if (payload.kind === "welcome") {
    const community = await prisma.telegramCommunity.findFirst({
      where: {
        id: payload.communityId,
        status: "ACTIVE",
        featureFlags: { has: "ONBOARDING" },
      },
      select: { id: true, communityName: true, telegramChatId: true },
    });
    if (!community) {
      await ctx.reply("That KOS community link is no longer active.");
      return;
    }
    const membership = await ctx.api
      .getChatMember(community.telegramChatId, ctx.from.id)
      .catch(() => null);
    const active =
      membership &&
      (membership.status === "creator" ||
        membership.status === "administrator" ||
        membership.status === "member" ||
        (membership.status === "restricted" && membership.is_member));
    if (active) {
      await attachTelegramCommunityIdentity({
        communityId: community.id,
        telegramUserId: String(ctx.from.id),
        identityId: identity.id,
      });
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
  bot.command("points", (ctx) => showPoints(ctx));
  bot.command("leaderboard", (ctx) => {
    const raw = (ctx.match ?? "").trim().toLowerCase();
    const period: LeaderboardPeriod =
      raw === "month" ? "month" : raw === "all" ? "all" : "week";
    return showLeaderboard(ctx, period);
  });
  bot.command("invite", showInvite);
  bot.command("status", (ctx) => showAccessStatus(ctx));
  bot.command("admin", showAdmin);
  bot.callbackQuery("nav:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });
  bot.callbackQuery("nav:profile", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfile(ctx, true);
  });
  bot.callbackQuery("nav:points", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPoints(ctx, true);
  });
  bot.callbackQuery("nav:status", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAccessStatus(ctx, true);
  });
  bot.callbackQuery("nav:invite", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showInvite(ctx);
  });
  bot.callbackQuery(/^leaderboard:(week|month|all)$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLeaderboard(ctx, ctx.match[1] as LeaderboardPeriod, true);
  });
  bot.callbackQuery("onboarding:start", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showGettingStarted(ctx, undefined, true);
  });
  bot.callbackQuery("onboarding:complete", async (ctx) => {
    if (!ctx.from || ctx.chat?.type !== "private") return;
    const outcome = await completeTelegramOnboarding(ctx.from);
    await ctx.answerCallbackQuery({
      text: outcome.pendingApprovals
        ? "Onboarding complete. Your KOS team approval is pending."
        : "Onboarding complete. Join a connected KOS community to request access.",
      show_alert: true,
    });
    await showMenu(ctx, true);
  });
}
