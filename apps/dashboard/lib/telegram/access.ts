import type { Context } from "grammy";
import type { TelegramCommunity } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { telegramActorHasPermission } from "@/lib/telegram";
import { isTelegramAdmin } from "@kos/db";

type TelegramCommunityAccess = {
  community: TelegramCommunity;
  userId: string;
};

async function authorizeTelegramCommunityAdmin(
  ctx: Context,
  community: TelegramCommunity,
  permission: Permission,
): Promise<TelegramCommunityAccess | null> {
  if (!ctx.from) return null;
  const member = await ctx.api
    .getChatMember(community.telegramChatId, ctx.from.id)
    .catch(() => null);
  if (!member || !isTelegramAdmin(member)) {
    await ctx.reply("Only a current Telegram administrator can do that.");
    return null;
  }
  const access = await telegramActorHasPermission({
    telegramUserId: String(ctx.from.id),
    organizationId: community.organizationId,
    permission,
  });
  if (!access.ok) {
    await ctx.reply(access.reason);
    return null;
  }
  return { community, userId: access.userId };
}

export async function requireTelegramCommunityPermission(
  ctx: Context,
  permission: Permission,
  featureFlag?: string,
): Promise<TelegramCommunityAccess | null> {
  if (
    !ctx.from ||
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type)
  ) {
    await ctx.reply(
      "Use this command inside an authorized Telegram community.",
    );
    return null;
  }
  const community = await prisma.telegramCommunity.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
  });
  if (
    !community ||
    community.status !== "ACTIVE" ||
    (featureFlag && !community.featureFlags.includes(featureFlag))
  ) {
    await ctx.reply("This feature is not enabled for this KOS community.");
    return null;
  }
  return authorizeTelegramCommunityAdmin(ctx, community, permission);
}

export async function requirePrivateTelegramCommunityPermission(
  ctx: Context,
  communityId: string,
  permission: Permission,
  featureFlag?: string,
): Promise<TelegramCommunityAccess | null> {
  if (!ctx.from) return null;
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Open KOS Bot privately to use this admin control.");
    return null;
  }
  const community = await prisma.telegramCommunity.findUnique({
    where: { id: communityId },
  });
  if (
    !community ||
    community.status !== "ACTIVE" ||
    (featureFlag && !community.featureFlags.includes(featureFlag))
  ) {
    await ctx.reply("This feature is not enabled for this KOS community.");
    return null;
  }
  return authorizeTelegramCommunityAdmin(ctx, community, permission);
}
