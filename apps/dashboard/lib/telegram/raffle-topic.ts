import { type Bot, type Context } from "grammy";
import type { Prisma } from "@prisma/client";
import { telegramRaffleDefaults } from "@kos/db";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requireTelegramCommunityPermission } from "@/lib/telegram/access";

/**
 * `/raffletopic` designates which forum topic KOS raffle messages land in.
 *
 * Telegram gives no way to name a topic through the API, so the reliable way
 * to identify one is to be inside it: the command message carries the
 * `message_thread_id`. Run it in the topic to set, `clear` anywhere to go back
 * to the main chat, `show` to read the current setting.
 */

function currentSettings(
  value: Prisma.JsonValue | null,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function raffleTopic(ctx: Context): Promise<void> {
  const access = await requireTelegramCommunityPermission(
    ctx,
    PERMISSIONS.SETTINGS_EDIT,
  );
  if (!access) return;

  const argument = String(ctx.match ?? "")
    .trim()
    .toLowerCase();
  const current = telegramRaffleDefaults(
    access.community.defaultRaffleSettings,
  ).raffleTopicId;

  if (argument === "show") {
    await ctx.reply(
      current
        ? `KOS raffles post to topic ${current}.`
        : "KOS raffles post to the main chat. Run /raffletopic inside a topic to change that.",
    );
    return;
  }

  const clearing = argument === "clear" || argument === "off";
  const threadId = ctx.message?.message_thread_id ?? null;

  if (!clearing && !threadId) {
    await ctx.reply(
      "Run /raffletopic inside the topic that should carry KOS raffles, or /raffletopic clear to post in the main chat.",
    );
    return;
  }

  const next = clearing ? null : threadId;
  if (next === current) {
    await ctx.reply(
      next
        ? "KOS raffles already post to this topic."
        : "KOS raffles already post to the main chat.",
    );
    return;
  }

  await prisma.telegramCommunity.update({
    where: { id: access.community.id },
    data: {
      defaultRaffleSettings: {
        ...currentSettings(access.community.defaultRaffleSettings),
        raffleTopicId: next,
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        organizationId: access.community.organizationId,
        actorId: access.userId,
        action: "TELEGRAM_RAFFLE_TOPIC_SET",
        targetType: "telegram_community",
        targetId: access.community.id,
        metadata: { raffleTopicId: next },
      },
    })
    .catch(() => undefined);

  await ctx.reply(
    next
      ? "KOS raffles will post in this topic from now on. Existing raffle messages stay where they were posted."
      : "KOS raffles will post to the main chat from now on.",
  );
}

export function registerTelegramRaffleTopicHandlers(bot: Bot): void {
  bot.command("raffletopic", raffleTopic);
}
