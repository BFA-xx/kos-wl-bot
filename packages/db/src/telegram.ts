import { createHash, randomUUID } from "node:crypto";
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

export interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramEligibilityResult {
  status: "eligible" | "ineligible" | "unavailable";
  reasons: string[];
}

export interface TelegramRaffleDefaults {
  membershipRequired: boolean;
  remainUntilEnd: boolean;
  winnerVisibility: "PUBLIC" | "ANONYMOUS" | "ADMIN_ONLY";
  autoAnnouncements: boolean;
  /**
   * Forum topic to post raffle messages into, when the group uses topics.
   * Null posts to the main chat, which is also the fallback if the topic is
   * later closed or deleted. Lives in `defaultRaffleSettings` rather than its
   * own column so enabling topics needs no migration.
   */
  raffleTopicId: number | null;
  /** Forum topic used for member welcome and onboarding messages. */
  welcomeTopicId: number | null;
  /**
   * The welcome currently standing in that topic. Each new join replaces it,
   * so the topic holds one live welcome instead of a scroll of dead ones.
   */
  welcomeMessageId: string | null;
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

export function telegramRaffleDefaults(value: unknown): TelegramRaffleDefaults {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const winnerVisibility = ["PUBLIC", "ANONYMOUS", "ADMIN_ONLY"].includes(
    String(settings.winnerVisibility),
  )
    ? (settings.winnerVisibility as TelegramRaffleDefaults["winnerVisibility"])
    : "PUBLIC";
  const topic = Number(settings.raffleTopicId);
  const welcomeTopic = Number(settings.welcomeTopicId);
  return {
    membershipRequired: settings.membershipRequired === true,
    remainUntilEnd: settings.remainUntilEnd === true,
    winnerVisibility,
    autoAnnouncements: settings.autoAnnouncements !== false,
    // Telegram thread ids are positive integers; anything else means "no topic".
    raffleTopicId: Number.isSafeInteger(topic) && topic > 0 ? topic : null,
    welcomeTopicId:
      Number.isSafeInteger(welcomeTopic) && welcomeTopic > 0
        ? welcomeTopic
        : null,
    welcomeMessageId:
      typeof settings.welcomeMessageId === "string" && settings.welcomeMessageId
        ? settings.welcomeMessageId
        : null,
  };
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

/**
 * Create each configured Telegram mirror once after the authoritative Discord
 * raffle post succeeds. Reposts are safe: existing publications are skipped.
 */
export async function autoPublishRaffleToTelegram(
  db: PrismaClient,
  raffleId: number,
): Promise<number> {
  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      guildId: true,
      createdById: true,
      status: true,
      endAt: true,
    },
  });
  if (!raffle || (raffle.status !== "LIVE" && raffle.status !== "UPCOMING")) {
    return 0;
  }

  const communities = await db.telegramCommunity.findMany({
    where: {
      backingGuildId: raffle.guildId,
      status: "ACTIVE",
      featureFlags: { has: "AUTO_ANNOUNCEMENTS" },
      publications: { none: { raffleId: raffle.id } },
    },
    select: {
      id: true,
      telegramChatId: true,
      communityName: true,
      defaultRaffleSettings: true,
    },
  });

  let published = 0;
  for (const community of communities) {
    const defaults = telegramRaffleDefaults(community.defaultRaffleSettings);
    const publicationId = randomUUID();
    const created = await db.$transaction(async (tx) => {
      const claimed = await tx.telegramRafflePublication.createMany({
        data: [
          {
            id: publicationId,
            raffleId: raffle.id,
            communityId: community.id,
            createdById: raffle.createdById,
            autoAnnouncements: defaults.autoAnnouncements,
            winnerVisibility: defaults.winnerVisibility,
          },
        ],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return false;

      await tx.integrationActionToken.create({
        data: {
          action: "TELEGRAM_ENTER",
          publicationId,
          singleUse: false,
          expiresAt: new Date(raffle.endAt.getTime() + 86_400_000),
        },
      });
      if (defaults.membershipRequired) {
        await tx.raffleEligibilityRule.create({
          data: {
            raffleId: raffle.id,
            publicationId,
            provider: "TELEGRAM",
            type: "TELEGRAM_CHAT_MEMBER",
            checkAt: defaults.remainUntilEnd ? "BOTH" : "ENTRY",
            config: {
              chatId: community.telegramChatId,
              chatName: community.communityName,
            },
          },
        });
      }

      const deliveries: Prisma.IntegrationDeliveryCreateManyInput[] = [
        {
          event: "RAFFLE_CREATED",
          communityId: community.id,
          publicationId,
          raffleId: raffle.id,
          dedupeKey: `telegram:RAFFLE_CREATED:${publicationId}:auto`,
        },
      ];
      const reminderAt = new Date(raffle.endAt.getTime() - 10 * 60_000);
      if (defaults.autoAnnouncements && reminderAt.getTime() > Date.now()) {
        deliveries.push({
          event: "RAFFLE_ENDING_SOON",
          communityId: community.id,
          publicationId,
          raffleId: raffle.id,
          dedupeKey: `telegram:RAFFLE_ENDING_SOON:${publicationId}:auto`,
          notBefore: reminderAt,
        });
      }
      await tx.integrationDelivery.createMany({
        data: deliveries,
        skipDuplicates: true,
      });
      return true;
    });
    if (created) published += 1;
  }
  return published;
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
