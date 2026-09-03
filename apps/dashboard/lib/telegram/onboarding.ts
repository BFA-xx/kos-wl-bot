import { InlineKeyboard, type Context } from "grammy";
import type { User as TelegramUser } from "grammy/types";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { telegramActorHasPermission } from "@/lib/telegram";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { awardKosPoints } from "@/lib/telegram/points";
import { completeReferral } from "@/lib/telegram/referrals";

export async function completeTelegramOnboarding(user: TelegramUser): Promise<{
  identityId: string;
  newlyCompleted: boolean;
  pendingApprovals: number;
}> {
  const identity = await ensureTelegramIdentity(user);
  const updated = await prisma.kosIdentity.updateMany({
    where: { id: identity.id, onboardingStatus: { not: "COMPLETED" } },
    data: { onboardingStatus: "COMPLETED" },
  });
  const pendingApprovals = await prisma.telegramCommunityMember.count({
    where: { identityId: identity.id, approvalStatus: "PENDING" },
  });
  return {
    identityId: identity.id,
    newlyCompleted: updated.count === 1,
    pendingApprovals,
  };
}

export async function activateApprovedOnboarding(
  identityId: string,
): Promise<number> {
  const reward = await awardKosPoints({
    identityId,
    event: "ONBOARDING_COMPLETED",
    reason: "KOS Telegram onboarding approved",
    source: "telegram_onboarding",
    referenceId: identityId,
  });
  await completeReferral(identityId);
  return reward.awarded ? reward.amount : 0;
}

export async function notifyTelegramOnboardingAdmins(
  ctx: Context,
  identityId: string,
  communityId?: string,
): Promise<number> {
  if (!ctx.from || ctx.chat?.type !== "private") return 0;
  const [identity, requests] = await Promise.all([
    prisma.kosIdentity.findUnique({
      where: { id: identityId },
      select: {
        displayName: true,
        accounts: {
          where: { provider: "TELEGRAM" },
          select: { username: true },
          take: 1,
        },
      },
    }),
    prisma.telegramCommunityMember.findMany({
      where: {
        identityId,
        approvalStatus: "PENDING",
        ...(communityId ? { communityId } : {}),
      },
      select: {
        id: true,
        community: {
          select: {
            id: true,
            organizationId: true,
            telegramChatId: true,
            communityName: true,
          },
        },
      },
    }),
  ]);
  if (!identity || !requests.length) return 0;

  let sent = 0;
  const notified = new Set<string>();
  for (const request of requests) {
    const { community } = request;
    const alreadyNotified = await prisma.auditLog.findFirst({
      where: {
        organizationId: community.organizationId,
        action: "TELEGRAM_ACCESS_REVIEW_REQUESTED",
        targetType: "telegram_community_member",
        targetId: request.id,
      },
      select: { id: true },
    });
    if (alreadyNotified) continue;
    const administrators = await ctx.api
      .getChatAdministrators(community.telegramChatId)
      .catch(() => []);
    let requestDeliveries = 0;
    for (const administrator of administrators) {
      if (administrator.user.is_bot) continue;
      const key = `${community.id}:${administrator.user.id}`;
      if (notified.has(key)) continue;
      const access = await telegramActorHasPermission({
        telegramUserId: String(administrator.user.id),
        organizationId: community.organizationId,
        permission: PERMISSIONS.MEMBER_MANAGE,
      });
      if (!access.ok) continue;
      notified.add(key);
      const username = identity.accounts[0]?.username;
      const delivered = await ctx.api
        .sendMessage(
          administrator.user.id,
          [
            "New KOS access request",
            "",
            `${identity.displayName}${username ? ` (@${username})` : ""} completed onboarding for ${community.communityName}.`,
            "Review this request privately.",
          ].join("\n"),
          {
            reply_markup: new InlineKeyboard().text(
              "Review request",
              `approval:list:${community.id}`,
            ),
          },
        )
        .then(() => true)
        .catch(() => false);
      if (delivered) sent += 1;
      if (delivered) requestDeliveries += 1;
    }
    if (requestDeliveries) {
      await prisma.auditLog.create({
        data: {
          organizationId: community.organizationId,
          action: "TELEGRAM_ACCESS_REVIEW_REQUESTED",
          targetType: "telegram_community_member",
          targetId: request.id,
          metadata: {
            telegramUserId: String(ctx.from.id),
            reviewerNotifications: requestDeliveries,
          },
        },
      });
    }
  }
  return sent;
}
