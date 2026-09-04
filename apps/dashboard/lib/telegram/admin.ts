import { type Bot, type Context, InlineKeyboard } from "grammy";
import type { KosModerationActionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { editOrReply, type RenderOutcome } from "@/lib/telegram/edit-or-reply";
import { unlinkIdentityX } from "@/lib/telegram/x-link-admin";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  findPrivateTelegramCommunityAccesses,
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

const APPROVAL_PAGE_SIZE = 8;

/**
 * Filter for the approval queue. Matches the KOS display name, any linked
 * provider handle (Telegram or X), or the raw Telegram user id, so a reviewer
 * can find someone by whatever identifier they actually have to hand.
 */
function approvalWhere(communityId: string, query: string) {
  const q = query.trim().slice(0, 64);
  return {
    communityId,
    approvalStatus: "PENDING" as const,
    identityId: { not: null },
    ...(q
      ? {
          OR: [
            {
              identity: {
                displayName: { contains: q, mode: "insensitive" as const },
              },
            },
            {
              identity: {
                accounts: {
                  some: {
                    username: { contains: q, mode: "insensitive" as const },
                  },
                },
              },
            },
            { telegramUserId: { contains: q } },
          ],
        }
      : {}),
  };
}

/**
 * Callback payload for a page of the queue, or null when it will not fit.
 *
 * Telegram caps callback_data at 64 BYTES, and the search term is carried in
 * it so paging keeps the filter. A long or non-ASCII term can exceed that, so
 * the caller drops the nav buttons rather than sending something Telegram
 * rejects.
 */
function approvalPageData(
  communityId: string,
  page: number,
  query: string,
): string | null {
  const encoded = query ? Buffer.from(query, "utf8").toString("base64url") : "";
  const data = `approval:page:${communityId}:${page}:${encoded}`;
  return Buffer.byteLength(data, "utf8") <= 64 ? data : null;
}

export function decodeApprovalQuery(encoded: string): string {
  if (!encoded) return "";
  // Node does not throw on invalid base64url — it silently drops the bad
  // characters and hands back garbage bytes. Reject anything outside the
  // alphabet so a malformed payload becomes an empty search, not mojibake.
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return "";
  return Buffer.from(encoded, "base64url").toString("utf8").slice(0, 64);
}

export interface ApprovalRow {
  index: number;
  tg: string;
  x: string;
  invite: boolean;
}

/**
 * The queue as an aligned monospace table.
 *
 * Telegram truncates inline button text to the button width, which reduced
 * every name to something like "Tr...x7_". The message body has no such limit,
 * so the identifying columns live here and the buttons carry only an index.
 *
 * Display names come from Telegram and are attacker-controlled, so the whole
 * block is escaped before it is wrapped in <pre> — otherwise a name containing
 * markup would break out of the block and Telegram would reject the message.
 */
export function approvalTableBlock(rows: ApprovalRow[]): string {
  const tgWidth = Math.max(8, ...rows.map((row) => row.tg.length));
  // Index column is padStart(2), so the header must match it exactly or
  // every column below sits one character off.
  const header = `${"#".padStart(2, " ")}  ${"Telegram".padEnd(tgWidth, " ")}  X`;
  const body = rows.map((row) => {
    const index = String(row.index).padStart(2, " ");
    const tg = row.tg.padEnd(tgWidth, " ");
    return `${index}  ${tg}  ${row.x}${row.invite ? "  +" : ""}`;
  });
  return `<pre>${escapeTelegramHtml([header, ...body].join("\n"))}</pre>`;
}

async function buildApprovalQueue(communityId: string, page = 0, query = "") {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 0;
  const where = approvalWhere(communityId, query);
  const [pending, total] = await Promise.all([
    prisma.telegramCommunityMember.findMany({
      where,
      include: {
        identity: {
          select: {
            displayName: true,
            onboardingStatus: true,
            // Reviewers judge an application on the X account behind it, so
            // the handle belongs on the button, not one screen deeper.
            accounts: {
              where: { provider: { in: ["TELEGRAM", "X"] } },
              select: { provider: true, username: true },
            },
          },
        },
      },
      orderBy: { requestedAt: "asc" },
      skip: safePage * APPROVAL_PAGE_SIZE,
      take: APPROVAL_PAGE_SIZE,
    }),
    prisma.telegramCommunityMember.count({ where }),
  ]);

  const keyboard = new InlineKeyboard();
  const rows: ApprovalRow[] = [];
  pending.forEach((member, offset) => {
    const index = safePage * APPROVAL_PAGE_SIZE + offset + 1;
    const accounts = member.identity?.accounts ?? [];
    const tg =
      accounts.find((a) => a.provider === "TELEGRAM")?.username ??
      member.identity?.displayName ??
      member.telegramUserId;
    const x = accounts.find((a) => a.provider === "X")?.username;
    rows.push({
      index,
      tg: tg.slice(0, 18),
      x: x ? `@${x.slice(0, 17)}` : "—",
      invite: member.status !== "ACTIVE",
    });
    // Names live in the message body, not on the buttons: Telegram truncates
    // button text to fit the width, which turned every name into "Tr...x7_".
    keyboard
      .text(`Approve ${index}`, `approval:approve:${member.id}:${safePage}`)
      .text(`Reject ${index}`, `approval:reject:${member.id}:${safePage}`)
      .row();
  });

  const first = total === 0 ? 0 : safePage * APPROVAL_PAGE_SIZE + 1;
  const last = safePage * APPROVAL_PAGE_SIZE + pending.length;
  const prev =
    safePage > 0 ? approvalPageData(communityId, safePage - 1, query) : null;
  const next =
    last < total ? approvalPageData(communityId, safePage + 1, query) : null;
  if (prev) keyboard.text("Previous", prev);
  if (next) keyboard.text("Next", next);
  if (prev || next) keyboard.row();
  const refresh = approvalPageData(communityId, safePage, query);
  keyboard.text("Refresh", refresh ?? `approval:list:${communityId}`);
  if (query) keyboard.text("Clear search", `approval:list:${communityId}`);

  const lines: string[] = [];
  if (total === 0) {
    lines.push(
      query
        ? `No pending KOS access requests match "${escapeTelegramHtml(query)}".`
        : "There are no pending KOS access requests.",
    );
  } else {
    lines.push(
      query
        ? `<b>Pending requests matching "${escapeTelegramHtml(query)}": ${total}</b>`
        : `<b>Pending KOS access requests: ${total}</b>`,
    );
    lines.push(`Showing ${first}-${last}.`);
    lines.push("");
    // Monospace keeps the columns aligned; the body wraps where a button
    // cannot, so this is the only place a long handle stays readable.
    lines.push(approvalTableBlock(rows));
    if (rows.some((r) => r.invite)) {
      lines.push("+ not in the group — approval sends an invite link.");
    }
    if (!prev && !next && last < total) {
      lines.push("Use a shorter search term to page through these.");
    }
  }
  if (!query)
    lines.push(
      escapeTelegramHtml("Search with /approvals <name, @handle or id>."),
    );
  return { keyboard, text: lines.join("\n") };
}

async function showPrivateApprovalQueue(
  ctx: Context,
  communityId: string,
  edit = false,
  page = 0,
  query = "",
): Promise<RenderOutcome | "denied"> {
  const access = await requirePrivateTelegramCommunityPermission(
    ctx,
    communityId,
    PERMISSIONS.MEMBER_MANAGE,
    "ONBOARDING",
  );
  if (!access) return "denied";
  const { keyboard, text } = await buildApprovalQueue(
    access.community.id,
    page,
    query,
  );
  return editOrReply(
    ctx,
    text,
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    },
    edit,
  );
}

async function openPrivateApprovalQueue(
  ctx: Context,
  query = "",
): Promise<void> {
  if (ctx.chat?.type === "private") {
    const accesses = await findPrivateTelegramCommunityAccesses(
      ctx,
      PERMISSIONS.MEMBER_MANAGE,
      "ONBOARDING",
    );
    if (accesses.length === 1) {
      await showPrivateApprovalQueue(
        ctx,
        accesses[0].community.id,
        false,
        0,
        query,
      );
      return;
    }
    if (accesses.length > 1) {
      const keyboard = new InlineKeyboard();
      for (const { community } of accesses) {
        keyboard
          .text(
            community.communityName.slice(0, 60),
            `approval:list:${community.id}`,
          )
          .row();
      }
      await ctx.reply("Choose a community to review access requests.", {
        reply_markup: keyboard,
      });
    }
    return;
  }
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
  page = 0,
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
  const memberKeyboard = new InlineKeyboard();
  if (invite) {
    memberKeyboard
      .url(
        `Join ${access.community.communityName}`.slice(0, 60),
        invite.invite_link,
      )
      .row();
  }
  memberKeyboard
    .text("Check access", "nav:status")
    .text("Explore raffles", "raffles:list");
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
        ? `Your access to ${access.community.communityName} was approved.${points ? ` You received ${points} KOS points.` : ""}${invite ? " Use the private button below to join the Telegram community." : " You can now use its KOS raffles and member features."}`
        : `Your access request for ${access.community.communityName} was not approved. You can check your current access status below.`,
      { reply_markup: memberKeyboard },
    )
    .catch(() => undefined);
  await ctx.answerCallbackQuery({
    text: `Access ${decision === "approve" ? "approved" : "rejected"}.`,
  });
  await showPrivateApprovalQueue(ctx, access.community.id, true, page);
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

/**
 * Release a member's X link so they can connect a different account.
 *
 * Admins live in Telegram during an event, and the member who authorized the
 * wrong X account is already messaging them there — sending them to the web
 * dashboard to fix it is the wrong shape. Reply to the member's message with
 * /unlinkx.
 */
async function unlinkMemberX(ctx: Context): Promise<void> {
  const access = await moderationAccess(ctx);
  const target = repliedUser(ctx);
  if (!access || !target) {
    if (access && !target) {
      await ctx.reply("Reply to a member's message with /unlinkx.");
    }
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
    await ctx.reply("That member has no KOS identity yet.");
    return;
  }

  const result = await unlinkIdentityX(
    account.identityId,
    ctx.from ? String(ctx.from.id) : null,
  );
  await ctx.reply(
    result.ok
      ? [
          `Unlinked ${result.xHandle ? `@${result.xHandle}` : "their X account"}.`,
          "They can now tap Connect X in onboarding and authorize the right account.",
        ].join("\n")
      : result.reason,
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
  if (ctx.chat?.type === "private") {
    const accesses = await findPrivateTelegramCommunityAccesses(
      ctx,
      PERMISSIONS.SETTINGS_EDIT,
    );
    if (accesses.length === 1) {
      await showPrivateSettings(ctx, accesses[0].community.id);
      return;
    }
    if (accesses.length > 1) {
      const keyboard = new InlineKeyboard();
      for (const { community } of accesses) {
        keyboard
          .text(
            community.communityName.slice(0, 60),
            `settings:open:${community.id}`,
          )
          .row();
      }
      await ctx.reply("Choose a community to open its settings.", {
        reply_markup: keyboard,
      });
    }
    return;
  }
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

async function showPrivateSettings(
  ctx: Context,
  communityId: string,
): Promise<void> {
  const access = await requirePrivateTelegramCommunityPermission(
    ctx,
    communityId,
    PERMISSIONS.SETTINGS_EDIT,
  );
  if (!access) return;
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: access.community.organizationId },
    select: { slug: true },
  });
  await ctx.reply("Open KOS organization settings.", {
    reply_markup: new InlineKeyboard().url(
      "KOS settings",
      `${dashboardOrigin()}/${organization.slug}/settings`,
    ),
  });
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
  bot.command("unlinkx", unlinkMemberX);
  bot.command("settings", settings);
  bot.command("approvals", (ctx) =>
    openPrivateApprovalQueue(ctx, commandText(ctx)),
  );
  bot.callbackQuery("approval:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openPrivateApprovalQueue(ctx);
  });
  bot.callbackQuery(/^approval:list:([a-z0-9]{20,36})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPrivateApprovalQueue(ctx, ctx.match[1], true);
  });
  bot.callbackQuery(
    /^approval:page:([a-z0-9]{20,36}):(\d{1,3}):([A-Za-z0-9_-]*)$/u,
    async (ctx) => {
      // Answered after the work, not before, so Refresh can say whether
      // anything actually changed. An unchanged queue edits nothing, and
      // without a word the button looks broken. Permission denial replies
      // rather than answering, so every path answers here or the client
      // spins.
      const outcome = await showPrivateApprovalQueue(
        ctx,
        ctx.match[1],
        true,
        Number(ctx.match[2]),
        decodeApprovalQuery(ctx.match[3]),
      );
      await ctx
        .answerCallbackQuery(
          outcome === "unchanged"
            ? { text: "Queue is up to date." }
            : undefined,
        )
        .catch(() => undefined);
    },
  );
  bot.callbackQuery(
    /^approval:(approve|reject):([a-z0-9]{20,36})(?::(\d{1,3}))?$/u,
    (ctx) =>
      reviewApproval(
        ctx,
        ctx.match[1] as "approve" | "reject",
        ctx.match[2],
        Number(ctx.match[3] ?? 0),
      ),
  );
  bot.callbackQuery(/^settings:open:([a-z0-9]{20,36})$/u, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPrivateSettings(ctx, ctx.match[1]);
  });
}
