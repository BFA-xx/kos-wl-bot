import type { Context } from "grammy";
import type { TelegramCommunity } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { telegramActorHasPermission } from "@/lib/telegram";
import { isTelegramAdmin } from "@kos/db";

export async function requireTelegramCommunityPermission(
  ctx: Context,
  permission: Permission,
  featureFlag?: string,
): Promise<{ community: TelegramCommunity; userId: string } | null> {
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
  const member = await ctx.api
    .getChatMember(ctx.chat.id, ctx.from.id)
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
