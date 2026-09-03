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
import { createXLinkUrl } from "@/lib/telegram/x-link";
import { evaluateXFollowGate } from "@/lib/telegram/x-follow";
import {
  completeTelegramOnboarding,
  notifyTelegramOnboardingAdmins,
} from "@/lib/telegram/onboarding";
import {
  getKosLeaderboard,
  getKosPointsSummary,
  type LeaderboardPeriod,
} from "@/lib/telegram/points";
import { ensureReferralCode, recordReferral } from "@/lib/telegram/referrals";
import { showTelegramRaffle } from "@/lib/telegram/raffles";
import {
  attachTelegramCommunityIdentity,
  discoverTelegramCommunityAccess,
  findTelegramCommunityReapplications,
  restartTelegramCommunityApplication,
} from "@/lib/telegram/community";

function onboardingCallback(step: string, communityId?: string): string {
  return communityId
    ? `onboarding:${step}:${communityId}`
    : `onboarding:${step}`;
}

function mainMenuKeyboard(onboardingComplete = true): InlineKeyboard {
  const origin = dashboardOrigin();
  const keyboard = new InlineKeyboard();
  if (!onboardingComplete) {
    keyboard.text("Continue onboarding", "onboarding:start").row();
  }
  return keyboard
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
    mainMenuKeyboard(identity.onboardingStatus === "COMPLETED"),
    edit,
  );
}

async function showGettingStarted(
  ctx: Context,
  communityName?: string,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  const memberships = await prisma.telegramCommunityMember.findMany({
    where: { identityId: identity.id },
    select: { community: { select: { communityName: true } } },
    take: 3,
  });
  const communities = memberships
    .map(({ community }) => community.communityName)
    .join(", ");
  await render(
    ctx,
    [
      "<b>KOS ONBOARDING</b>",
      "Step 1 of 6 - Welcome",
      "",
      `Welcome to ${escapeTelegramHtml((communityName ?? communities) || "KOS")}.`,
      "This short setup verifies Telegram, creates your KOS identity, and submits any community access request for team review.",
      "Existing KOS profile and wallet connections are optional.",
    ].join("\n"),
    new InlineKeyboard()
      .text("Begin onboarding", onboardingCallback("telegram", communityId))
      .row()
      .text("Back to menu", "nav:menu"),
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

async function showTelegramOnboardingStep(
  ctx: Context,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  await ensureTelegramIdentity(ctx.from);
  const account = ctx.from.username
    ? `@${escapeTelegramHtml(ctx.from.username)}`
    : escapeTelegramHtml(telegramDisplayName(ctx.from));
  await render(
    ctx,
    [
      "<b>KOS ONBOARDING</b>",
      "Step 2 of 6 - Telegram verified",
      "",
      `<b>${account}</b> is verified through your private Telegram session.`,
      "KOS uses your immutable Telegram account ID, not your changeable username, as the secure identity link.",
    ].join("\n"),
    new InlineKeyboard().text(
      "Continue",
      onboardingCallback("identity", communityId),
    ),
    edit,
  );
}

async function showIdentityOnboardingStep(
  ctx: Context,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  await prisma.kosIdentity.updateMany({
    where: { id: identity.id, onboardingStatus: "STARTED" },
    data: { onboardingStatus: "PROFILE_COMPLETE" },
  });
  await render(
    ctx,
    [
      "<b>KOS ONBOARDING</b>",
      "Step 3 of 6 - Identity created",
      "",
      `<b>${escapeTelegramHtml(identity.displayName)}</b>`,
      `KOS ID: <code>${identity.id}</code>`,
      "",
      "This identity will connect your community access, raffles, points, referrals, and future KOS products.",
    ].join("\n"),
    new InlineKeyboard().text(
      "Continue",
      onboardingCallback("connections", communityId),
    ),
    edit,
  );
}

async function showConnectionsOnboardingStep(
  ctx: Context,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  const walletCount = identity.legacyUserId
    ? await prisma.walletProfile.count({
        where: { userId: identity.legacyUserId },
      })
    : 0;
  const keyboard = new InlineKeyboard();
  if (!identity.legacyUserId) {
    keyboard
      .url("Connect existing KOS profile", `${dashboardOrigin()}/me`)
      .row();
  }
  keyboard
    .url("Add optional wallet", `${dashboardOrigin()}/me/wallets`)
    .row()
    .text(
      "Refresh connection status",
      onboardingCallback("connections", communityId),
    )
    .row()
    .text("Continue", onboardingCallback("xfollow", communityId));
  await render(
    ctx,
    [
      "<b>KOS ONBOARDING</b>",
      "Step 4 of 6 - Optional connections",
      "",
      `Existing KOS profile: <b>${identity.legacyUserId ? "Connected" : "Not connected"}</b>`,
      `Wallets: <b>${walletCount}</b>`,
      "",
      "",
      "<b>Recommended:</b> connect a KOS raffle profile. It is not required to finish onboarding, but without one you cannot enter raffles, and points earned here stay on Telegram instead of following you across KOS.",
      "A wallet is only needed for raffles that explicitly ask for one.",
    ].join("\n"),
    keyboard,
    edit,
  );
}

/**
 * Step 5 - follow KOS on X.
 *
 * This is the one required step that depends on a third party, so each state
 * says exactly what the member should do next. A member who cannot be checked
 * (X down, rate limited, checks paused) is never told they failed — the step
 * simply cannot be passed yet, and the wording says so.
 */
async function showXFollowOnboardingStep(
  ctx: Context,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  const gate = await evaluateXFollowGate(identity.id);
  const keyboard = new InlineKeyboard();
  const lines = ["<b>KOS ONBOARDING</b>", "Step 5 of 6 - Follow KOS on X", ""];

  if (gate.status === "not_configured") {
    // Nothing to follow: never strand a member on a step we cannot define.
    lines.push("This step is not set up yet, so you can carry on.");
    keyboard.text("Continue", onboardingCallback("review", communityId));
  } else if (gate.status === "following") {
    lines.push(
      `Following <b>@${escapeTelegramHtml(gate.target)}</b> \u2713`,
      gate.handle ? `Verified as <b>@${escapeTelegramHtml(gate.handle)}</b>.` : "",
      "",
      "Thanks \u2014 that is the last required step.",
    );
    keyboard.text("Continue", onboardingCallback("review", communityId));
  } else if (gate.status === "needs_link") {
    lines.push(
      `Follow <b>@${escapeTelegramHtml(gate.target)}</b> to finish onboarding.`,
      "",
      "Connect your X account so we can confirm the follow. You sign in with X itself \u2014 no KOS account needed, and we never see your password.",
    );
    keyboard
      .url("Connect X", await createXLinkUrl(identity.id))
      .row()
      .url(`Open @${gate.target}`, gate.profileUrl)
      .row()
      .text("I've connected X", onboardingCallback("xfollow", communityId));
  } else if (gate.status === "needs_follow") {
    lines.push(
      `Connected as <b>@${escapeTelegramHtml(gate.handle ?? "")}</b>.`,
      "",
      `You are not following <b>@${escapeTelegramHtml(gate.target)}</b> yet. Follow, then check again.`,
    );
    keyboard
      .url(`Follow @${gate.target}`, gate.profileUrl)
      .row()
      .text("Check follow", onboardingCallback("xfollow", communityId));
  } else {
    lines.push(
      escapeTelegramHtml(gate.reason),
      "",
      `Your follow of <b>@${escapeTelegramHtml(gate.target)}</b> has not been confirmed yet. This is on our side, not yours.`,
    );
    keyboard
      .url(`Open @${gate.target}`, gate.profileUrl)
      .row()
      .text("Try again", onboardingCallback("xfollow", communityId));
  }

  keyboard.row().text("Back", onboardingCallback("connections", communityId));
  await render(ctx, lines.filter(Boolean).join("\n"), keyboard, edit);
}

async function showOnboardingReview(
  ctx: Context,
  edit = false,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  await discoverTelegramCommunityAccess(ctx, identity.id);
  const [walletCount, memberships, xGate] = await Promise.all([
    identity.legacyUserId
      ? prisma.walletProfile.count({ where: { userId: identity.legacyUserId } })
      : 0,
    prisma.telegramCommunityMember.findMany({
      where: { identityId: identity.id },
      select: {
        approvalStatus: true,
        community: { select: { id: true, communityName: true } },
      },
      orderBy: { requestedAt: "desc" },
    }),
    evaluateXFollowGate(identity.id),
  ]);
  const xSatisfied = xGate.status === "following" || xGate.status === "not_configured";
  const requests = memberships.map(
    ({ community, approvalStatus }) =>
      `${escapeTelegramHtml(community.communityName)}: ${community.id === communityId ? "READY TO REAPPLY" : approvalStatus}`,
  );
  const hasPendingRequest = memberships.some(
    ({ community, approvalStatus }) =>
      approvalStatus === "PENDING" || community.id === communityId,
  );
  await render(
    ctx,
    [
      "<b>KOS ONBOARDING</b>",
      "Step 5 of 6 - Review",
      "",
      "Telegram: <b>Verified</b>",
      "KOS identity: <b>Ready</b>",
      ...(xGate.status === "not_configured"
        ? []
        : [
            `Follow @${escapeTelegramHtml(xGate.target)}: <b>${xGate.status === "following" ? "Confirmed" : "Required"}</b>`,
          ]),
      `Existing KOS profile: <b>${identity.legacyUserId ? "Connected" : "Optional"}</b>`,
      `Wallets: <b>${walletCount}</b>`,
      "",
      ...(requests.length
        ? ["Community access:", ...requests]
        : [
            "Community access: No community selected.",
            "You can finish your KOS identity now and request community access later from a group welcome link.",
          ]),
    ].join("\n"),
    xSatisfied
      ? new InlineKeyboard()
          .text(
            communityId
              ? "Submit new access request"
              : hasPendingRequest
                ? "Submit for team approval"
                : "Finish KOS identity",
            onboardingCallback("submit", communityId),
          )
          .row()
          .text("Back", onboardingCallback("connections", communityId))
      : new InlineKeyboard()
          .text(
            `Follow @${xGate.target} to finish`,
            onboardingCallback("xfollow", communityId),
          )
          .row()
          .text("Back", onboardingCallback("connections", communityId)),
    edit,
  );
}

async function showReapplicationPrompt(
  ctx: Context,
  identityId: string,
  edit = false,
): Promise<boolean> {
  if (!ctx.from || ctx.chat?.type !== "private") return false;
  const communities = await findTelegramCommunityReapplications({
    identityId,
    telegramUserId: String(ctx.from.id),
  });
  if (!communities.length) return false;
  const keyboard = new InlineKeyboard();
  for (const community of communities.slice(0, 8)) {
    keyboard
      .text(
        `Apply again: ${community.communityName}`.slice(0, 60),
        onboardingCallback("start", community.id),
      )
      .row();
  }
  keyboard.text("Open menu", "nav:menu");
  await render(
    ctx,
    [
      "<b>REAPPLY FOR KOS ACCESS</b>",
      "",
      "Your KOS identity and history are still safe.",
      "Because you left the Telegram community, you can run the onboarding experience again and submit a fresh access request.",
    ].join("\n"),
    keyboard,
    edit,
  );
  return true;
}

async function showOnboardingOutcome(
  ctx: Context,
  edit = false,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  const memberships = await prisma.telegramCommunityMember.findMany({
    where: { identityId: identity.id },
    include: { community: { select: { communityName: true } } },
    orderBy: { requestedAt: "desc" },
  });
  const pending = memberships.filter(
    ({ approvalStatus }) => approvalStatus === "PENDING",
  );
  const approved = memberships.filter(
    ({ approvalStatus }) => approvalStatus === "APPROVED",
  );
  const title = pending.length
    ? "ONBOARDING SUBMITTED"
    : approved.length
      ? "ONBOARDING COMPLETE"
      : "KOS IDENTITY READY";
  const details = pending.length
    ? [
        `Access requests pending: <b>${pending.length}</b>`,
        "The request is in the private admin review queue.",
        "You will receive the result here. Your onboarding points activate after approval.",
      ]
    : approved.length
      ? [
          `Approved communities: <b>${approved.length}</b>`,
          "Your KOS community access is active.",
        ]
      : [
          "Your KOS identity is complete.",
          "Use the KOS Bot welcome link in a connected community to request access.",
        ];
  await render(
    ctx,
    [
      `<b>${title}</b>`,
      "",
      `<b>${escapeTelegramHtml(identity.displayName)}</b>`,
      `KOS ID: <code>${identity.id}</code>`,
      "",
      ...details,
    ].join("\n"),
    new InlineKeyboard()
      .text("Check access status", "nav:status")
      .row()
      .text("My profile", "nav:profile")
      .text("Explore raffles", "raffles:list"),
    edit,
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
    await ctx.reply(
      "Your KOS community access must be approved before you can create invites.",
    );
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
  await discoverTelegramCommunityAccess(ctx, identity.id);
  const memberships = await prisma.telegramCommunityMember.findMany({
    where: { identityId: identity.id },
    include: { community: { select: { communityName: true } } },
    orderBy: { requestedAt: "desc" },
  });
  const lines = memberships.map(
    (member) =>
      `${escapeTelegramHtml(member.community.communityName)}: ${member.approvalStatus}${member.status === "LEFT" ? " (LEFT GROUP)" : ""}`,
  );
  const keyboard = new InlineKeyboard();
  if (identity.onboardingStatus !== "COMPLETED") {
    keyboard.text("Continue onboarding", "onboarding:start").row();
  }
  const reapplications = await findTelegramCommunityReapplications({
    identityId: identity.id,
    telegramUserId: String(ctx.from.id),
  });
  for (const community of reapplications.slice(0, 6)) {
    keyboard
      .text(
        `Apply again: ${community.communityName}`.slice(0, 60),
        onboardingCallback("start", community.id),
      )
      .row();
  }
  keyboard.text("Back", "nav:menu");
  await render(
    ctx,
    [
      "<b>KOS ACCESS</b>",
      "",
      `Onboarding: ${identity.onboardingStatus}`,
      ...(lines.length
        ? lines
        : [
            "No connected KOS community membership was found for this Telegram account.",
          ]),
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
    if (identity.onboardingStatus === "COMPLETED") {
      const reapplications = await findTelegramCommunityReapplications({
        identityId: identity.id,
        telegramUserId: String(ctx.from.id),
      });
      const canReapply = reapplications.some(({ id }) => id === community.id);
      if (canReapply) {
        await showGettingStarted(
          ctx,
          community.communityName,
          false,
          community.id,
        );
      } else {
        await notifyTelegramOnboardingAdmins(ctx, identity.id, community.id);
        await showOnboardingOutcome(ctx);
      }
    } else {
      await showWelcome(ctx, community.communityName);
    }
    return;
  }
  if (payload.kind === "onboarding") {
    await showGettingStarted(ctx);
    return;
  }
  if (identity.onboardingStatus === "STARTED") {
    await showWelcome(ctx);
    return;
  }
  if (identity.onboardingStatus === "PROFILE_COMPLETE") {
    await showConnectionsOnboardingStep(ctx);
    return;
  }
  if (await showReapplicationPrompt(ctx, identity.id)) return;
  await showMenu(ctx);
}

async function submitOnboarding(
  ctx: Context,
  communityId?: string,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  const identity = await ensureTelegramIdentity(ctx.from);
  if (communityId) {
    const restarted = await restartTelegramCommunityApplication({
      communityId,
      identityId: identity.id,
      telegramUserId: String(ctx.from.id),
    });
    if (!restarted) {
      await ctx.answerCallbackQuery({
        text: "This application cannot be restarted. Check your current access status.",
        show_alert: true,
      });
      await showAccessStatus(ctx, true);
      return;
    }
  }
  // The gate lives here, not only in the UI: a member could otherwise reach
  // submit through an older keyboard and skip the step entirely.
  const gate = await evaluateXFollowGate(identity.id);
  if (gate.status !== "following" && gate.status !== "not_configured") {
    await ctx.answerCallbackQuery({
      text: "Follow KOS on X to finish onboarding.",
      show_alert: true,
    });
    await showXFollowOnboardingStep(ctx, true, communityId);
    return;
  }

  await ctx.answerCallbackQuery({ text: "Submitting onboarding..." });
  const outcome = await completeTelegramOnboarding(ctx.from);
  const pendingApprovals = await discoverTelegramCommunityAccess(
    ctx,
    outcome.identityId,
  );
  if (pendingApprovals) {
    await notifyTelegramOnboardingAdmins(ctx, outcome.identityId, communityId);
  }
  await showOnboardingOutcome(ctx, true);
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
  bot.callbackQuery("onboarding:telegram", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTelegramOnboardingStep(ctx, true);
  });
  bot.callbackQuery("onboarding:identity", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showIdentityOnboardingStep(ctx, true);
  });
  bot.callbackQuery("onboarding:connections", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showConnectionsOnboardingStep(ctx, true);
  });
  bot.callbackQuery("onboarding:xfollow", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Checking X..." });
    await showXFollowOnboardingStep(ctx, true);
  });
  bot.callbackQuery("onboarding:review", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showOnboardingReview(ctx, true);
  });
  bot.callbackQuery("onboarding:complete", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showOnboardingReview(ctx, true);
  });
  bot.callbackQuery("onboarding:submit", async (ctx) => {
    await submitOnboarding(ctx);
  });
  bot.callbackQuery(
    /^onboarding:(start|telegram|identity|connections|xfollow|review|submit):([a-z0-9]{20,36})$/u,
    async (ctx) => {
      const step = ctx.match[1];
      const communityId = ctx.match[2];
      if (step === "submit") {
        await submitOnboarding(ctx, communityId);
        return;
      }
      await ctx.answerCallbackQuery();
      if (step === "start") {
        const identity = ctx.from
          ? await ensureTelegramIdentity(ctx.from)
          : null;
        const communities = identity
          ? await findTelegramCommunityReapplications({
              identityId: identity.id,
              telegramUserId: String(ctx.from!.id),
            })
          : [];
        const community = communities.find(({ id }) => id === communityId);
        if (!community) {
          await showAccessStatus(ctx, true);
          return;
        }
        await showGettingStarted(
          ctx,
          community.communityName,
          true,
          communityId,
        );
        return;
      }
      if (step === "telegram") {
        await showTelegramOnboardingStep(ctx, true, communityId);
      } else if (step === "identity") {
        await showIdentityOnboardingStep(ctx, true, communityId);
      } else if (step === "connections") {
        await showConnectionsOnboardingStep(ctx, true, communityId);
        return;
      }
      if (step === "xfollow") {
        await showXFollowOnboardingStep(ctx, true, communityId);
      } else {
        await showOnboardingReview(ctx, true, communityId);
      }
    },
  );
}
