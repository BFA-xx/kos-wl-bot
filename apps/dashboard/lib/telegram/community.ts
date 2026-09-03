import { type Bot, type Context, InlineKeyboard } from "grammy";
import { telegramDisplayName } from "@kos/db";
import { prisma } from "@/lib/db";
import { didTelegramMemberJoin } from "@/lib/telegram";
import {
  dashboardOrigin,
  escapeTelegramHtml,
  telegramUserMention,
} from "@/lib/telegram/format";

async function showTelegramChatId(ctx: Context): Promise<void> {
  if (!ctx.chat || ctx.chat.type === "private") {
    await ctx.reply(
      "Use this command inside the Telegram group you want to connect.",
    );
    return;
  }
  await ctx.reply(
    `Telegram chat ID: ${ctx.chat.id}\nAdd it under your KOS organization Settings.`,
  );
}

async function welcomeTelegramMember(ctx: Context): Promise<void> {
  const update = ctx.update.chat_member;
  if (
    !update ||
    !["group", "supergroup"].includes(update.chat.type) ||
    update.new_chat_member.user.is_bot
  ) {
    return;
  }
  const community = await prisma.telegramCommunity.findFirst({
    where: {
      telegramChatId: String(update.chat.id),
      status: "ACTIVE",
    },
    select: { id: true, communityName: true },
  });
  if (!community) return;

  const member = update.new_chat_member.user;
  const joined = didTelegramMemberJoin(
    update.old_chat_member,
    update.new_chat_member,
  );
  const activeStatuses = ["creator", "administrator", "member"];
  const status =
    update.new_chat_member.status === "kicked"
      ? "BANNED"
      : activeStatuses.includes(update.new_chat_member.status) ||
          (update.new_chat_member.status === "restricted" &&
            update.new_chat_member.is_member)
        ? "ACTIVE"
        : "LEFT";
  const account = await prisma.identityAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(member.id),
      },
    },
    select: {
      identityId: true,
      identity: { select: { onboardingStatus: true } },
    },
  });
  const trackedMember = await prisma.telegramCommunityMember.upsert({
    where: {
      communityId_telegramUserId: {
        communityId: community.id,
        telegramUserId: String(member.id),
      },
    },
    create: {
      communityId: community.id,
      telegramUserId: String(member.id),
      identityId: account?.identityId,
      status,
      leftAt: status === "ACTIVE" ? null : new Date(),
    },
    update: {
      identityId: account?.identityId,
      status,
      joinedAt: joined ? new Date() : undefined,
      leftAt: status === "ACTIVE" ? null : new Date(),
      lastSeenAt: new Date(),
    },
    select: { approvalStatus: true },
  });
  if (!joined) return;
  const onboardingEnabled = await prisma.telegramCommunity.count({
    where: { id: community.id, featureFlags: { has: "ONBOARDING" } },
  });
  if (!onboardingEnabled) return;
  const memberName = telegramDisplayName(member).slice(0, 80);
  const mention = telegramUserMention(member.id, memberName);
  const completed = account?.identity.onboardingStatus === "COMPLETED";
  const approved = trackedMember.approvalStatus === "APPROVED";
  const rejected = trackedMember.approvalStatus === "REJECTED";
  const message = approved
    ? [
        `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
        "",
        "Your KOS access is active. Open KOS Bot for raffles, points, invitations, and your profile.",
      ]
    : rejected
      ? [
          `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
          "",
          "Your previous KOS access request was not approved. Check your current status privately in KOS Bot.",
        ]
      : completed
        ? [
            `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
            "",
            "Your KOS identity is ready and your access request is pending private team review.",
            "Track the result in your private KOS Bot chat.",
          ]
        : [
            `Welcome ${mention} to ${escapeTelegramHtml(community.communityName)}.`,
            "",
            "Start the guided KOS onboarding to verify your identity and request community access.",
            "A wallet is optional unless a specific raffle requires one.",
          ];
  await ctx.api.sendMessage(update.chat.id, message.join("\n"), {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .url(
        "Start KOS Bot",
        `https://t.me/${ctx.me.username}?start=welcome_${community.id}`,
      )
      .row()
      .url("Open KOS", `${dashboardOrigin()}/me`),
    link_preview_options: { is_disabled: true },
  });
}

export async function attachTelegramCommunityIdentity(input: {
  communityId: string;
  telegramUserId: string;
  identityId: string;
}): Promise<void> {
  await prisma.telegramCommunityMember.upsert({
    where: {
      communityId_telegramUserId: {
        communityId: input.communityId,
        telegramUserId: input.telegramUserId,
      },
    },
    create: {
      communityId: input.communityId,
      telegramUserId: input.telegramUserId,
      identityId: input.identityId,
      status: "ACTIVE",
    },
    update: {
      identityId: input.identityId,
      status: "ACTIVE",
      leftAt: null,
      lastSeenAt: new Date(),
    },
  });
}

function isActiveTelegramMembership(
  membership: Awaited<ReturnType<Context["api"]["getChatMember"]>>,
): boolean {
  return (
    membership.status === "creator" ||
    membership.status === "administrator" ||
    membership.status === "member" ||
    (membership.status === "restricted" && membership.is_member)
  );
}

export async function discoverTelegramCommunityAccess(
  ctx: Context,
  identityId: string,
): Promise<number> {
  if (!ctx.from || ctx.chat?.type !== "private") return 0;
  const telegramUserId = String(ctx.from.id);
  const identity = await prisma.kosIdentity.findUnique({
    where: { id: identityId },
    select: { onboardingStatus: true },
  });
  if (!identity) return 0;
  const communities = await prisma.telegramCommunity.findMany({
    where: { status: "ACTIVE", featureFlags: { has: "ONBOARDING" } },
    select: {
      id: true,
      telegramChatId: true,
      members: {
        where: { telegramUserId },
        select: { status: true },
        take: 1,
      },
    },
    take: 20,
  });

  for (const community of communities) {
    let active = community.members[0]?.status === "ACTIVE";
    if (!active) {
      const membership = await ctx.api
        .getChatMember(community.telegramChatId, ctx.from.id)
        .catch(() => null);
      active = Boolean(membership && isActiveTelegramMembership(membership));
    }
    if (active) {
      await attachTelegramCommunityIdentity({
        communityId: community.id,
        telegramUserId,
        identityId,
      });
    }
  }

  const existingApplications = await prisma.telegramCommunityMember.count({
    where: { identityId },
  });
  if (
    existingApplications === 0 &&
    identity.onboardingStatus === "COMPLETED" &&
    communities.length === 1
  ) {
    const community = communities[0];
    await prisma.telegramCommunityMember.upsert({
      where: {
        communityId_telegramUserId: {
          communityId: community.id,
          telegramUserId,
        },
      },
      create: {
        communityId: community.id,
        telegramUserId,
        identityId,
        status: "LEFT",
        approvalStatus: "PENDING",
        leftAt: new Date(),
      },
      update: { identityId, lastSeenAt: new Date() },
    });
  }

  return prisma.telegramCommunityMember.count({
    where: { identityId, approvalStatus: "PENDING" },
  });
}

export function registerTelegramCommunityHandlers(bot: Bot): void {
  bot.command("chatid", showTelegramChatId);
  bot.on("chat_member", welcomeTelegramMember);
}
