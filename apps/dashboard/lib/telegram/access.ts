import type { Context } from "grammy";
import type { TelegramCommunity } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { telegramActorHasPermission } from "@/lib/telegram";
import { isTelegramAdmin } from "@kos/db";

export type TelegramCommunityAccess = {
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

export async function findPrivateTelegramCommunityAccesses(
  ctx: Context,
  permission: Permission,
  featureFlag?: string,
): Promise<TelegramCommunityAccess[]> {
  if (!ctx.from) return [];
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Open KOS Bot privately to use this admin control.");
    return [];
  }
  const account = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(ctx.from.id),
      },
    },
    select: { userId: true },
  });
  if (!account) {
    await ctx.reply("Link this Telegram account to KOS first.");
    return [];
  }
  const organizations = await prisma.organization.findMany({
    where: {
      suspendedAt: null,
      OR: [
        { ownerId: account.userId },
        { members: { some: { userId: account.userId, status: "ACTIVE" } } },
      ],
    },
    select: { id: true },
  });
  if (!organizations.length) {
    await ctx.reply("No KOS communities are available for this admin command.");
    return [];
  }
  const communities = await prisma.telegramCommunity.findMany({
    where: {
      organizationId: { in: organizations.map(({ id }) => id) },
      status: "ACTIVE",
      ...(featureFlag ? { featureFlags: { has: featureFlag } } : {}),
    },
    orderBy: { communityName: "asc" },
  });
  const candidates = await Promise.all(
    communities.map(async (community) => {
      const member = await ctx.api
        .getChatMember(community.telegramChatId, ctx.from!.id)
        .catch(() => null);
      if (!member || !isTelegramAdmin(member)) return null;
      const access = await telegramActorHasPermission({
        telegramUserId: String(ctx.from!.id),
        organizationId: community.organizationId,
        permission,
      });
      return access.ok ? { community, userId: access.userId } : null;
    }),
  );
  const accesses = candidates.filter(
    (access): access is TelegramCommunityAccess => access !== null,
  );
  if (!accesses.length) {
    await ctx.reply(
      "No Telegram communities are available for this admin command.",
    );
  }
  return accesses;
}
