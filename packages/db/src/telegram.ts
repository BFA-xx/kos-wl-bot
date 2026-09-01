import { createHash } from "node:crypto";
import {
  type IntegrationDeliveryEvent,
  type Prisma,
  type PrismaClient,
  RaffleEligibilityCheckAt,
} from "@prisma/client";

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramIdentity {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChatMember {
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked";
  is_member?: boolean;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramEligibilityResult {
  status: "eligible" | "ineligible" | "unavailable";
  reasons: string[];
}

export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function telegramDisplayName(user: TelegramIdentity): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}

export function isTelegramMember(member: TelegramChatMember): boolean {
  return (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member" ||
    (member.status === "restricted" && member.is_member === true)
  );
}

export function isTelegramAdmin(member: TelegramChatMember): boolean {
  return member.status === "creator" || member.status === "administrator";
}

export async function callTelegramApi<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<TelegramEnvelope<T>> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const result = (await response
      .json()
      .catch(() => ({}))) as TelegramEnvelope<T>;
    return {
      ...result,
      ok: response.ok && result.ok === true,
      error_code: result.error_code ?? response.status,
    };
  } catch {
    return {
      ok: false,
      description: "Telegram request unavailable",
      error_code: 503,
    };
  }
}

export async function getTelegramChatMember(
  botToken: string,
  chatId: string,
  userId: string,
): Promise<TelegramEnvelope<TelegramChatMember>> {
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId) || numericUserId < 1) {
    return {
      ok: false,
      description: "Invalid Telegram user id",
      error_code: 400,
    };
  }
  return callTelegramApi<TelegramChatMember>(botToken, "getChatMember", {
    chat_id: chatId,
    user_id: numericUserId,
  });
}

export async function evaluateTelegramEligibility(
  db: PrismaClient,
  input: {
    raffleId: number;
    userId: string;
    checkAt: "ENTRY" | "DRAW";
    botToken?: string;
  },
): Promise<TelegramEligibilityResult> {
  const checkAt = input.checkAt as RaffleEligibilityCheckAt;
  const rules = await db.raffleEligibilityRule.findMany({
    where: {
      raffleId: input.raffleId,
      provider: { in: ["TELEGRAM", "KOS"] },
      checkAt: { in: [checkAt, RaffleEligibilityCheckAt.BOTH] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (rules.length === 0) return { status: "eligible", reasons: [] };

  const account = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId: input.userId, provider: "TELEGRAM" } },
    select: { externalId: true },
  });
  const reasons: string[] = [];

  for (const rule of rules) {
    if (rule.type === "KOS_ACCOUNT_LINKED") {
      if (!account) reasons.push("Link your Telegram account to KOS.");
      continue;
    }
    if (
      rule.type !== "TELEGRAM_CHAT_MEMBER" &&
      rule.type !== "TELEGRAM_CHAT_STATUS"
    ) {
      reasons.push("This Telegram eligibility rule is not available yet.");
      continue;
    }
    if (!account) {
      reasons.push("Link your Telegram account to KOS.");
      continue;
    }
    if (!input.botToken) {
      return {
        status: "unavailable",
        reasons: ["Telegram membership could not be checked right now."],
      };
    }
    const config = (rule.config ?? {}) as {
      chatId?: unknown;
      chatName?: unknown;
      allowedStatuses?: unknown;
    };
    const chatId = typeof config.chatId === "string" ? config.chatId : "";
    if (!chatId) {
      return {
        status: "unavailable",
        reasons: ["Telegram membership rule is misconfigured."],
      };
    }
    const response = await getTelegramChatMember(
      input.botToken,
      chatId,
      account.externalId,
    );
    if (!response.ok || !response.result) {
      const definiteNonMember =
        response.error_code === 400 &&
        /user not found|participant_id_invalid/iu.test(
          response.description ?? "",
        );
      if (definiteNonMember) {
        reasons.push(
          `Join ${typeof config.chatName === "string" ? config.chatName : "the required Telegram community"}.`,
        );
        continue;
      }
      return {
        status: "unavailable",
        reasons: ["Telegram membership could not be checked right now."],
      };
    }
    const configuredStatuses = Array.isArray(config.allowedStatuses)
      ? config.allowedStatuses.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const eligible = configuredStatuses.length
      ? configuredStatuses.includes(response.result.status)
      : isTelegramMember(response.result);
    if (!eligible) {
      reasons.push(
        `Join ${typeof config.chatName === "string" ? config.chatName : "the required Telegram community"}.`,
      );
    }
  }

  return reasons.length
    ? { status: "ineligible", reasons: [...new Set(reasons)] }
    : { status: "eligible", reasons: [] };
}

/** Queue one lifecycle event for every active Telegram publication. */
export async function enqueueTelegramRaffleEvent(
  db: PrismaClient,
  input: {
    raffleId: number;
    event: IntegrationDeliveryEvent;
    marker: string;
    notBefore?: Date;
    payload?: Prisma.InputJsonValue;
  },
): Promise<number> {
  const publications = await db.telegramRafflePublication.findMany({
    where: {
      raffleId: input.raffleId,
      autoAnnouncements: true,
      community: { status: "ACTIVE" },
    },
    select: { id: true, communityId: true },
  });
  if (publications.length === 0) return 0;
  const created = await db.integrationDelivery.createMany({
    data: publications.map((publication) => ({
      event: input.event,
      communityId: publication.communityId,
      publicationId: publication.id,
      raffleId: input.raffleId,
      dedupeKey: `telegram:${input.event}:${publication.id}:${input.marker}`,
      notBefore: input.notBefore ?? new Date(),
      ...(input.payload ? { payload: input.payload } : {}),
    })),
    skipDuplicates: true,
  });
  return created.count;
}
