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

interface TopicCommand {
  setting: "raffleTopicId" | "welcomeTopicId";
  command: "/raffletopic" | "/welcometopic";
  subject: "KOS raffles" | "KOS welcome messages";
  destination: "the topic" | "Start Here";
  auditAction: "TELEGRAM_RAFFLE_TOPIC_SET" | "TELEGRAM_WELCOME_TOPIC_SET";
}

export async function configureTelegramTopic(
  ctx: Context,
  config: TopicCommand,
): Promise<void> {
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
  )[config.setting];

  if (argument === "show") {
    await ctx.reply(
      current
        ? `${config.subject} post to topic ${current}.`
        : `${config.subject} post to the main chat. Run ${config.command} inside ${config.destination} to change that.`,
    );
    return;
  }

  const clearing = argument === "clear" || argument === "off";
  const threadId = ctx.message?.message_thread_id ?? null;

  if (!clearing && !threadId) {
    await ctx.reply(
      `Run ${config.command} inside ${config.destination}, or ${config.command} clear to post in the main chat.`,
    );
    return;
  }

  const next = clearing ? null : threadId;
  if (next === current) {
    await ctx.reply(
      next
        ? `${config.subject} already post to this topic.`
        : `${config.subject} already post to the main chat.`,
    );
    return;
  }

  await prisma.telegramCommunity.update({
    where: { id: access.community.id },
    data: {
      defaultRaffleSettings: {
        ...currentSettings(access.community.defaultRaffleSettings),
        [config.setting]: next,
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        organizationId: access.community.organizationId,
        actorId: access.userId,
        action: config.auditAction,
        targetType: "telegram_community",
        targetId: access.community.id,
        metadata: { [config.setting]: next },
      },
    })
    .catch(() => undefined);

  await ctx.reply(
    next
      ? `${config.subject} will post in this topic from now on. Existing messages stay where they were posted.`
      : `${config.subject} will post to the main chat from now on.`,
  );
}

export function registerTelegramRaffleTopicHandlers(bot: Bot): void {
  bot.command("raffletopic", (ctx) =>
    configureTelegramTopic(ctx, {
      setting: "raffleTopicId",
      command: "/raffletopic",
      subject: "KOS raffles",
      destination: "the topic",
      auditAction: "TELEGRAM_RAFFLE_TOPIC_SET",
    }),
  );
  bot.command("welcometopic", (ctx) =>
    configureTelegramTopic(ctx, {
      setting: "welcomeTopicId",
      command: "/welcometopic",
      subject: "KOS welcome messages",
      destination: "Start Here",
      auditAction: "TELEGRAM_WELCOME_TOPIC_SET",
    }),
  );
}
