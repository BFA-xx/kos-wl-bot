import { type Bot, type Context, InlineKeyboard } from "grammy";
import type { KosModerationActionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  requirePrivateTelegramCommunityPermission,
  requireTelegramCommunityPermission,
} from "@/lib/telegram/access";
import {
  dashboardOrigin,
  escapeTelegramHtml,
  telegramUserMention,
} from "@/lib/telegram/format";
import { awardKosPoints } from "@/lib/telegram/points";
import { activateApprovedOnboarding } from "@/lib/telegram/onboarding";

function commandText(ctx: Context): string {
  return typeof ctx.match === "string" ? ctx.match.trim() : "";
}

function repliedUser(ctx: Context) {
  return ctx.message?.reply_to_message?.from ?? null;
}

async function recordAdminAction(input: {
  communityId: string;
  organizationId: string;
  actorUserId: string;
  actorTelegramUserId: string;
  targetTelegramUserId: string;
  type: KosModerationActionType;
  reason?: string;
  durationSeconds?: number;
}): Promise<void> {
  await prisma.$transaction([
    prisma.kosModerationAction.create({
      data: {
        communityId: input.communityId,
        actorTelegramUserId: input.actorTelegramUserId,
        targetTelegramUserId: input.targetTelegramUserId,
        type: input.type,
        reason: input.reason?.slice(0, 500),
        durationSeconds: input.durationSeconds,
      },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorUserId,
        action: `TELEGRAM_${input.type}`,
        targetType: "telegram_user",
        targetId: input.targetTelegramUserId,
        metadata: {
          communityId: input.communityId,
          reason: input.reason?.slice(0, 500) ?? null,
          durationSeconds: input.durationSeconds ?? null,
        },
      },
    }),
  ]);
}

async function moderationAccess(
  ctx: Context,
): ReturnType<typeof requireTelegramCommunityPermission> {
  return requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.TELEGRAM_MODERATE,
    "MODERATION",
  );
}

async function warnMember(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  const target = repliedUser(ctx);
  if (!access || !ctx.from || !target) {
    if (access && !target)
      await ctx.reply(
        "Reply to the member's message with /warn and an optional reason.",
      );
    return;
  }
  if (target.is_bot) {
    await ctx.reply("Bots cannot receive KOS moderation warnings.");
    return;
  }
  const reason = commandText(ctx).slice(0, 500) || "Community rules reminder";
  await recordAdminAction({
    communityId: access.community.id,
    organizationId: access.community.organizationId,
    actorUserId: access.userId,
    actorTelegramUserId: String(ctx.from.id),
    targetTelegramUserId: String(target.id),
    type: "WARN",
    reason,
  });
  await ctx.reply(
    `${telegramUserMention(target.id, target.first_name)} warning: ${escapeTelegramHtml(reason)}`,
    { parse_mode: "HTML" },
  );
}

export function parseTelegramModerationDuration(value: string): number | null {
  const match = value.match(/^(\d{1,4})(m|h|d)$/iu);
  if (!match) return null;
  const count = Number(match[1]);
  const factor =
    match[2].toLowerCase() === "m"
      ? 60
      : match[2].toLowerCase() === "h"
        ? 3600
        : 86_400;
  const seconds = count * factor;
  return seconds >= 60 && seconds <= 366 * 86_400 ? seconds : null;
}

async function muteMember(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  const target = repliedUser(ctx);
  if (!access || !ctx.from || !ctx.chat || !target) {
    if (access && !target)
      await ctx.reply("Reply to a member with /mute 10m [reason].");
    return;
  }
  const [durationText, ...reasonParts] = commandText(ctx).split(/\s+/u);
  const durationSeconds = parseTelegramModerationDuration(durationText ?? "");
  if (!durationSeconds) {
    await ctx.reply("Usage: reply with /mute 10m [reason]. Units: m, h, d.");
    return;
  }
  const reason =
    reasonParts.join(" ").slice(0, 500) || "Temporary community mute";
  try {
    await ctx.api.restrictChatMember(
      ctx.chat.id,
      target.id,
      { can_send_messages: false },
      { until_date: Math.floor(Date.now() / 1000) + durationSeconds },
    );
  } catch {
    await ctx.reply(
      "Telegram rejected that mute. Check the bot's admin permissions and the target's role.",
    );
    return;
  }
  await recordAdminAction({
    communityId: access.community.id,
    organizationId: access.community.organizationId,
    actorUserId: access.userId,
    actorTelegramUserId: String(ctx.from.id),
    targetTelegramUserId: String(target.id),
    type: "MUTE",
    reason,
    durationSeconds,
  });
  await ctx.reply(
    `${telegramUserMention(target.id, target.first_name)} muted for ${durationText}.`,
    { parse_mode: "HTML" },
  );
}

async function banMember(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  const target = repliedUser(ctx);
  if (!access || !ctx.from || !ctx.chat || !target) {
    if (access && !target)
      await ctx.reply("Reply to the member's message with /ban [reason].");
    return;
  }
  const reason = commandText(ctx).slice(0, 500) || "Community ban";
  try {
    await ctx.api.banChatMember(ctx.chat.id, target.id);
  } catch {
    await ctx.reply(
      "Telegram rejected that ban. Check the bot's admin permissions and the target's role.",
    );
    return;
  }
  await recordAdminAction({
    communityId: access.community.id,
    organizationId: access.community.organizationId,
    actorUserId: access.userId,
    actorTelegramUserId: String(ctx.from.id),
    targetTelegramUserId: String(target.id),
    type: "BAN",
    reason,
  });
  await ctx.reply(`Telegram user ${target.id} was banned.`);
}

async function unbanMember(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  if (!access || !ctx.from || !ctx.chat) return;
  const raw = commandText(ctx);
  const targetId = /^\d{1,16}$/u.test(raw) ? Number(raw) : 0;
  if (!Number.isSafeInteger(targetId) || targetId < 1) {
    await ctx.reply("Usage: /unban <telegram-user-id>");
    return;
  }
  try {
    await ctx.api.unbanChatMember(ctx.chat.id, targetId, {
      only_if_banned: true,
    });
  } catch {
    await ctx.reply(
      "Telegram rejected that unban. Check the user ID and bot permissions.",
    );
    return;
  }
  await recordAdminAction({
    communityId: access.community.id,
    organizationId: access.community.organizationId,
    actorUserId: access.userId,
    actorTelegramUserId: String(ctx.from.id),
    targetTelegramUserId: String(targetId),
    type: "UNBAN",
  });
  await ctx.reply(`Telegram user ${targetId} was unbanned.`);
}

async function stats(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.SETTINGS_EDIT,
  );
  if (!access) return;
  const [members, pendingApprovals, liveRaffles, identities, warnings] =
    await Promise.all([
      prisma.telegramCommunityMember.count({
        where: { communityId: access.community.id, status: "ACTIVE" },
      }),
      prisma.telegramCommunityMember.count({
        where: { communityId: access.community.id, approvalStatus: "PENDING" },
      }),
      prisma.raffle.count({
        where: { guildId: access.community.backingGuildId, status: "LIVE" },
      }),
      prisma.kosIdentity.count({ where: { status: "ACTIVE" } }),
      prisma.kosModerationAction.count({
        where: { communityId: access.community.id, type: "WARN" },
      }),
    ]);
  await ctx.reply(
    [
      `KOS stats for ${access.community.communityName}`,
      `Tracked active Telegram members: ${members}`,
      `Pending approvals: ${pendingApprovals}`,
      `Live raffles: ${liveRaffles}`,
      `Global KOS identities: ${identities}`,
      `Warnings recorded: ${warnings}`,
    ].join("\n"),
  );
}

async function buildApprovalQueue(communityId: string) {
  const pending = await prisma.telegramCommunityMember.findMany({
    where: {
      communityId,
      approvalStatus: "PENDING",
      identityId: { not: null },
    },
    include: {
      identity: { select: { displayName: true, onboardingStatus: true } },
    },
    orderBy: { requestedAt: "asc" },
    take: 10,
  });
  const keyboard = new InlineKeyboard();
  for (const member of pending) {
    const label = (member.identity?.displayName ?? member.telegramUserId).slice(
      0,
      30,
    );
    const membershipSuffix = member.status === "ACTIVE" ? "" : " (invite)";
    keyboard
      .text(
        `Approve ${label}${membershipSuffix}`,
        `approval:approve:${member.id}`,
      )
      .text("Reject", `approval:reject:${member.id}`)
      .row();
  }
  if (pending.length) keyboard.text("Refresh", `approval:list:${communityId}`);
  const text = pending.length
    ? `Pending KOS access requests: ${pending.length}${pending.length === 10 ? "+" : ""}`
    : "There are no pending KOS access requests.";
  return { keyboard, text };
}

async function showPrivateApprovalQueue(
  ctx: Context,
  communityId: string,
  edit = false,
): Promise<void> {
  const access = await requirePrivateTelegramCommunityPermission(
    ctx,
    communityId,
    PERMISSIONS.MEMBER_MANAGE,
    "ONBOARDING",
  );
  if (!access) return;
  const { keyboard, text } = await buildApprovalQueue(access.community.id);
  if (edit && ctx.callbackQuery?.message) {
    await ctx
      .editMessageText(text, { reply_markup: keyboard })
      .catch(async () => ctx.reply(text, { reply_markup: keyboard }));
    return;
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

async function openPrivateApprovalQueue(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.MEMBER_MANAGE,
    "ONBOARDING",
  );
  if (!access || !ctx.from) return;
  await ctx.deleteMessage().catch(() => undefined);
  const { keyboard, text } = await buildApprovalQueue(access.community.id);
  await ctx.api
    .sendMessage(ctx.from.id, text, { reply_markup: keyboard })
    .catch(() => undefined);
}

async function reviewApproval(
  ctx: Context,
  decision: "approve" | "reject",
  memberId: string,
): Promise<void> {
  if (!ctx.from) return;
  const target = await prisma.telegramCommunityMember.findUnique({
    where: { id: memberId },
    select: { communityId: true },
  });
  if (!target) {
    await ctx.answerCallbackQuery({
      text: "This request is no longer pending.",
      show_alert: true,
    });
    return;
  }
  const access = await requirePrivateTelegramCommunityPermission(
    ctx,
    target.communityId,
    PERMISSIONS.MEMBER_MANAGE,
    "ONBOARDING",
  );
  if (!access) {
    await ctx
      .answerCallbackQuery({ text: "Not authorized." })
      .catch(() => undefined);
    return;
  }
  const member = await prisma.telegramCommunityMember.findFirst({
    where: { id: memberId, communityId: access.community.id },
    include: { identity: { select: { id: true, onboardingStatus: true } } },
  });
  if (!member || member.approvalStatus !== "PENDING" || !member.identity) {
    await ctx.answerCallbackQuery({
      text: "This request is no longer pending.",
      show_alert: true,
    });
    await showPrivateApprovalQueue(ctx, access.community.id, true);
    return;
  }
  if (
    decision === "approve" &&
    member.identity.onboardingStatus !== "COMPLETED"
  ) {
    await ctx.answerCallbackQuery({
      text: "The member must finish onboarding first.",
      show_alert: true,
    });
    return;
  }
  const status = decision === "approve" ? "APPROVED" : "REJECTED";
  const changed = await prisma.telegramCommunityMember.updateMany({
    where: { id: member.id, approvalStatus: "PENDING" },
    data: {
      approvalStatus: status,
      reviewedAt: new Date(),
      reviewedById: access.userId,
    },
  });
  if (!changed.count) {
    await ctx.answerCallbackQuery({
      text: "This request was already reviewed.",
    });
    return;
  }
  const points =
    decision === "approve"
      ? await activateApprovedOnboarding(member.identity.id)
      : 0;
  const invite =
    decision === "approve" && member.status !== "ACTIVE"
      ? await ctx.api
          .createChatInviteLink(access.community.telegramChatId, {
            name: `KOS approval ${member.telegramUserId}`.slice(0, 32),
            expire_date: Math.floor(Date.now() / 1000) + 86_400,
            member_limit: 1,
          })
          .catch(() => null)
      : null;
  await prisma.auditLog.create({
    data: {
      organizationId: access.community.organizationId,
      actorId: access.userId,
      action: `TELEGRAM_ACCESS_${status}`,
      targetType: "kos_identity",
      targetId: member.identity.id,
      metadata: {
        communityId: access.community.id,
        telegramUserId: member.telegramUserId,
        groupInviteIssued: Boolean(invite),
      },
    },
  });
  await ctx.api
    .sendMessage(
      member.telegramUserId,
      decision === "approve"
        ? `Your access to ${access.community.communityName} was approved.${points ? ` You received ${points} KOS points.` : ""}${invite ? " Use the private button below to join the Telegram community." : ""}`
        : `Your access request for ${access.community.communityName} was not approved.`,
      invite
        ? {
            reply_markup: new InlineKeyboard().url(
              `Join ${access.community.communityName}`.slice(0, 60),
              invite.invite_link,
            ),
          }
        : undefined,
    )
    .catch(() => undefined);
  await ctx.answerCallbackQuery({
    text: `Access ${decision === "approve" ? "approved" : "rejected"}.`,
  });
  await showPrivateApprovalQueue(ctx, access.community.id, true);
}

async function announce(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.TELEGRAM_ANNOUNCE,
    "ANNOUNCEMENTS",
  );
  if (!access || !ctx.chat) return;
  const text = commandText(ctx);
  if (!text || text.length > 3500) {
    await ctx.reply("Usage: /announce <message up to 3500 characters>");
    return;
  }
  await ctx.api.sendMessage(ctx.chat.id, `KOS ANNOUNCEMENT\n\n${text}`, {
    link_preview_options: { is_disabled: true },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: access.community.organizationId,
      actorId: access.userId,
      action: "TELEGRAM_ANNOUNCE",
      targetType: "telegram_community",
      targetId: access.community.id,
      metadata: { characterCount: text.length },
    },
  });
}

async function givePoints(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.POINTS_AWARD,
    "POINTS",
  );
  const target = repliedUser(ctx);
  if (!access || !ctx.from || !target) {
    if (access && !target)
      await ctx.reply("Reply to a member with /givepoints <amount> [reason].");
    return;
  }
  const match = commandText(ctx).match(/^(\d{1,5})(?:\s+(.+))?$/u);
  const amount = match ? Number(match[1]) : 0;
  if (amount < 1 || amount > 10_000) {
    await ctx.reply("Point amount must be from 1 to 10000.");
    return;
  }
  const account = await prisma.identityAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(target.id),
      },
    },
    select: { identityId: true },
  });
  if (!account) {
    await ctx.reply(
      "That member must start KOS Bot before receiving KOS points.",
    );
    return;
  }
  const membership = await prisma.telegramCommunityMember.findUnique({
    where: {
      communityId_telegramUserId: {
        communityId: access.community.id,
        telegramUserId: String(target.id),
      },
    },
  });
  if (membership?.approvalStatus !== "APPROVED") {
    await ctx.reply(
      "Approve this member's KOS community access before awarding points.",
    );
    return;
  }
  const referenceId = `${ctx.chat!.id}:${ctx.message!.message_id}`;
  const reward = await awardKosPoints({
    identityId: account.identityId,
    event: "ADMIN_REWARD",
    amount,
    reason: (match?.[2] ?? "Community admin award").slice(0, 240),
    source: "telegram_admin",
    referenceId,
  });
  await prisma.auditLog.create({
    data: {
      organizationId: access.community.organizationId,
      actorId: access.userId,
      action: "TELEGRAM_GIVE_POINTS",
      targetType: "kos_identity",
      targetId: account.identityId,
      metadata: { amount, awarded: reward.awarded, referenceId },
    },
  });
  await ctx.reply(
    reward.awarded
      ? `Awarded ${amount} KOS points.`
      : "This point award was already processed.",
  );
}

async function inspectUser(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  const target = repliedUser(ctx);
  if (!access || !target) {
    if (access && !target)
      await ctx.reply("Reply to a member's message with /user.");
    return;
  }
  const account = await prisma.identityAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(target.id),
      },
    },
    include: {
      identity: { select: { id: true, onboardingStatus: true, status: true } },
    },
  });
  const membership = await prisma.telegramCommunityMember.findUnique({
    where: {
      communityId_telegramUserId: {
        communityId: access.community.id,
        telegramUserId: String(target.id),
      },
    },
  });
  await ctx.reply(
    [
      `Telegram ID: ${target.id}`,
      `KOS identity: ${account?.identity.id ?? "not started"}`,
      `Identity status: ${account?.identity.status ?? "n/a"}`,
      `Onboarding: ${account?.identity.onboardingStatus ?? "n/a"}`,
      `Community state: ${membership?.status ?? "untracked"}`,
      `KOS access: ${membership?.approvalStatus ?? "not requested"}`,
    ].join("\n"),
  );
}

async function settings(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.SETTINGS_EDIT,
  );
  if (!access || !ctx.from) return;
  await ctx.deleteMessage().catch(() => undefined);
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: access.community.organizationId },
    select: { slug: true },
  });
  await ctx.api
    .sendMessage(ctx.from.id, "Open KOS organization settings.", {
      reply_markup: new InlineKeyboard().url(
        "KOS settings",
        `${dashboardOrigin()}/${organization.slug}/settings`,
      ),
    })
    .catch(() => undefined);
}

export function registerTelegramAdminHandlers(bot: Bot): void {
  bot.command("warn", warnMember);
  bot.command("mute", muteMember);
  bot.command("ban", banMember);
  bot.command("unban", unbanMember);
  bot.command("stats", stats);
  bot.command("announce", announce);
  bot.command("givepoints", givePoints);
  bot.command("user", inspectUser);
  bot.command("settings", settings);
  bot.command("approvals", openPrivateApprovalQueue);
  bot.callbackQuery("approval:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openPrivateApprovalQueue(ctx);
  });
  bot.callbackQuery(/^approval:list:([a-z0-9]{20,36})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPrivateApprovalQueue(ctx, ctx.match[1], true);
  });
  bot.callbackQuery(/^approval:(approve|reject):([a-z0-9]{20,36})$/u, (ctx) =>
    reviewApproval(ctx, ctx.match[1] as "approve" | "reject", ctx.match[2]),
  );
}
