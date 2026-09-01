import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { hasPermission, type Permission } from "@/lib/permissions";
import {
  callTelegramApi,
  getTelegramChatMember,
  isTelegramAdmin,
} from "@kos/db";

export const TELEGRAM_FEATURE_FLAGS = [
  "QUICK_RAFFLES",
  "ONBOARDING",
  "RAFFLES",
  "POINTS",
  "REFERRALS",
  "MODERATION",
  "ANNOUNCEMENTS",
  "AUTO_ANNOUNCEMENTS",
  "MEMBERSHIP_CHECKS",
] as const;

export function telegramConfig(): {
  botToken: string | null;
  botUsername: string | null;
  webhookSecret: string | null;
} {
  const clean = (value: string | undefined) => value?.trim() || null;
  return {
    botToken:
      clean(process.env.TELEGRAM_BOT_TOKEN) ?? clean(process.env.BOT_TOKEN),
    botUsername:
      clean(process.env.TELEGRAM_BOT_USERNAME)?.replace(/^@/u, "") ?? null,
    webhookSecret:
      clean(process.env.TELEGRAM_WEBHOOK_SECRET) ??
      clean(process.env.WEBHOOK_SECRET),
  };
}

export function secureStringEqual(
  left: string | null,
  right: string | null,
): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeTelegramChatId(value: unknown): string | null {
  const chatId = typeof value === "string" ? value.trim() : String(value ?? "");
  return /^-?\d{1,20}$/u.test(chatId) ? chatId : null;
}

interface TelegramMembershipState {
  status: string;
  is_member?: boolean;
}

function hasTelegramMembership(member: TelegramMembershipState): boolean {
  return (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member" ||
    (member.status === "restricted" && member.is_member === true)
  );
}

export function didTelegramMemberJoin(
  previous: TelegramMembershipState,
  current: TelegramMembershipState,
): boolean {
  return !hasTelegramMembership(previous) && hasTelegramMembership(current);
}

export async function verifyTelegramCommunity(chatId: string): Promise<{
  ok: boolean;
  name?: string;
  reason?: string;
}> {
  const { botToken } = telegramConfig();
  if (!botToken) return { ok: false, reason: "telegram_not_configured" };
  const me = await callTelegramApi<{ id: number; username?: string }>(
    botToken,
    "getMe",
  );
  if (!me.ok || !me.result)
    return { ok: false, reason: "telegram_unavailable" };
  const chat = await callTelegramApi<{ title?: string; type?: string }>(
    botToken,
    "getChat",
    { chat_id: chatId },
  );
  if (!chat.ok || !chat.result) return { ok: false, reason: "chat_not_found" };
  const membership = await getTelegramChatMember(
    botToken,
    chatId,
    String(me.result.id),
  );
  if (
    !membership.ok ||
    !membership.result ||
    !isTelegramAdmin(membership.result)
  ) {
    return { ok: false, reason: "bot_must_be_admin" };
  }
  return { ok: true, name: chat.result.title?.trim() || chatId };
}

export async function telegramActorHasPermission(input: {
  telegramUserId: string;
  organizationId: string;
  permission: Permission;
}): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: input.telegramUserId,
      },
    },
    select: { userId: true },
  });
  if (!account)
    return { ok: false, reason: "Link this Telegram account to KOS first." };
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { ownerId: true, suspendedAt: true },
  });
  if (!org || org.suspendedAt)
    return { ok: false, reason: "This KOS community is unavailable." };
  if (org.ownerId === account.userId)
    return { ok: true, userId: account.userId };
  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: account.userId,
      },
    },
    include: { role: { select: { permissions: true } } },
  });
  if (
    !member ||
    member.status !== "ACTIVE" ||
    !hasPermission(
      { isOwner: false, permissions: member.role.permissions },
      input.permission,
    )
  ) {
    return {
      ok: false,
      reason: `Missing KOS permission: ${input.permission}.`,
    };
  }
  return { ok: true, userId: account.userId };
}
