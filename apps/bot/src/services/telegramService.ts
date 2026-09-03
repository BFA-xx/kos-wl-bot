import {
  callTelegramApi,
  IntegrationDeliveryEvent,
  prisma,
  telegramRaffleDefaults,
  type TelegramWinnerVisibility,
} from "@kos/db";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { publicRafflePath } from "../utils/raffleShare.js";

interface TelegramMessage {
  message_id: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function raffleUrl(input: {
  id: number;
  projectName: string;
  organizationSlug: string;
}): string {
  return `${config.PUBLIC_RAFFLE_ORIGIN}${publicRafflePath(
    input.id,
    input.organizationSlug,
    input.projectName,
  )}`;
}

/**
 * A raffle topic can be closed, deleted, or the group can stop being a forum
 * long after an admin configured it. Telegram rejects the send in each case, so
 * fall back to the main chat rather than letting the delivery burn its eight
 * retries and drop the announcement entirely.
 */
export function isTopicUnavailable(description?: string): boolean {
  if (!description) return false;
  return /thread not found|topic_deleted|topic_closed|topic (?:is )?closed|not a forum|topics are disabled/iu.test(
    description,
  );
}

export async function sendToCommunity(
  botToken: string,
  chatId: string,
  topicId: number | null,
  body: Record<string, unknown>,
  /** Injectable so the fallback is testable without a live Telegram. */
  call: typeof callTelegramApi = callTelegramApi,
  method: "sendMessage" | "sendPhoto" = "sendMessage",
) {
  if (topicId) {
    const threaded = await call<TelegramMessage>(botToken, method, {
      ...body,
      chat_id: chatId,
      message_thread_id: topicId,
    });
    if (threaded.ok || !isTopicUnavailable(threaded.description)) {
      return threaded;
    }
    logger.warn(
      { chatId, topicId, error: threaded.description },
      "Telegram raffle topic unavailable, posting to the main chat",
    );
  }
  return call<TelegramMessage>(botToken, method, {
    ...body,
    chat_id: chatId,
  });
}

/** Telegram caps a photo caption at 1024 characters; plain text gets 4096. */
const CAPTION_LIMIT = 1024;

/**
 * Absolute, publicly fetchable banner for a raffle, or null.
 *
 * Telegram fetches the URL from its own servers, so it has to be reachable
 * without a session. `/r/<id>/banner` is deliberately outside the dashboard's
 * auth middleware for exactly this reason.
 */
export function raffleBannerForTelegram(
  bannerUrl: string | null,
): string | null {
  if (!bannerUrl) return null;
  try {
    const url = new URL(bannerUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusHeading(event: IntegrationDeliveryEvent): string {
  if (event === "RAFFLE_STARTING") return "KOS RAFFLE IS LIVE";
  if (event === "RAFFLE_COMPLETED") return "KOS RAFFLE COMPLETE";
  if (event === "RAFFLE_CANCELLED") return "KOS RAFFLE CANCELLED";
  return "KOS RAFFLE";
}

async function deliverRaffleMessage(deliveryId: string): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot is not configured");
  const delivery = await prisma.integrationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      community: { include: { organization: { select: { slug: true } } } },
      publication: { include: { entryActionToken: true } },
      raffle: {
        include: {
          winners: {
            where: { replaced: false },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });
  if (!delivery || !delivery.publication || !delivery.raffle) return;
  const { publication, raffle, community } = delivery;
  if (community.status !== "ACTIVE") return;
  const { raffleTopicId } = telegramRaffleDefaults(
    community.defaultRaffleSettings,
  );
  const url = raffleUrl({
    id: raffle.id,
    projectName: raffle.projectName,
    organizationSlug: community.organization.slug,
  });

  if (delivery.event === "RAFFLE_ENDING_SOON") {
    if (raffle.status !== "LIVE" || raffle.endAt <= new Date()) return;
    const response = await sendToCommunity(
      token,
      community.telegramChatId,
      raffleTopicId,
      {
        parse_mode: "HTML",
        text: `<b>10 MINUTES LEFT</b>\n\n${escapeHtml(raffle.projectName)} ends soon.`,
        reply_markup: {
          inline_keyboard: [
            publication.entryActionToken
              ? [
                  {
                    text: "Enter now",
                    callback_data: `a:${publication.entryActionToken.id}`,
                  },
                  { text: "View details", url },
                ]
              : [{ text: "View details", url }],
          ],
        },
      },
    );
    if (!response.ok)
      throw new Error(response.description ?? "Telegram reminder failed");
    return;
  }

  if (delivery.event === "WINNER_SELECTED") {
    await deliverWinners({
      botToken: token,
      chatId: community.telegramChatId,
      topicId: raffleTopicId,
      raffle,
      visibility: publication.winnerVisibility,
      url,
    });
    return;
  }

  const status =
    raffle.status === "LIVE"
      ? "Open"
      : raffle.status === "UPCOMING"
        ? "Scheduled"
        : raffle.status;
  const lines = [
    `<b>${statusHeading(delivery.event)}</b>`,
    "",
    `<b>Project:</b> ${escapeHtml(raffle.projectName)}`,
    `<b>Prize:</b> ${escapeHtml(raffle.title)}`,
    `<b>Winners:</b> ${raffle.spots}`,
    `<b>Status:</b> ${escapeHtml(status)}`,
    `<b>Ends:</b> ${raffle.endAt.toISOString()}`,
  ];
  const keyboard: { text: string; callback_data?: string; url?: string }[][] =
    [];
  if (
    (raffle.status === "LIVE" || raffle.status === "UPCOMING") &&
    publication.entryActionToken
  ) {
    keyboard.push([
      {
        text: raffle.status === "LIVE" ? "Enter raffle" : "Entry opens soon",
        ...(raffle.status === "LIVE"
          ? { callback_data: `a:${publication.entryActionToken.id}` }
          : { url }),
      },
      { text: "View details", url },
    ]);
  } else {
    keyboard.push([{ text: "View details", url }]);
  }
  const text = lines.join("\n");
  const banner = raffleBannerForTelegram(raffle.bannerUrl);
  const body = {
    chat_id: community.telegramChatId,
    message_id: publication.telegramMessageId
      ? Number(publication.telegramMessageId)
      : undefined,
    parse_mode: "HTML",
    text,
    reply_markup: { inline_keyboard: keyboard },
    disable_web_page_preview: true,
  };

  if (publication.telegramMessageId) {
    // A photo post carries a caption, not text, and Telegram rejects the wrong
    // editor. We do not record which kind was sent, so try the one the current
    // banner implies and fall back — a raffle can gain or lose a banner after
    // its first post.
    const editors = banner
      ? (["editMessageCaption", "editMessageText"] as const)
      : (["editMessageText", "editMessageCaption"] as const);
    for (const editor of editors) {
      const payload =
        editor === "editMessageCaption"
          ? { ...body, text: undefined, caption: text.slice(0, CAPTION_LIMIT) }
          : body;
      const edited = await callTelegramApi<true>(token, editor, payload);
      if (edited.ok || edited.description?.includes("message is not modified"))
        return;
    }
  }

  const post = { ...body, message_id: undefined };
  let sent = banner
    ? await sendToCommunity(
        token,
        community.telegramChatId,
        raffleTopicId,
        {
          photo: banner,
          caption: text.slice(0, CAPTION_LIMIT),
          parse_mode: "HTML",
          reply_markup: post.reply_markup,
        },
        callTelegramApi,
        "sendPhoto",
      )
    : null;

  if (sent && !sent.ok) {
    // Telegram fetches the image from its own servers, so a banner that is
    // unreachable or rejected must not cost the community its announcement.
    logger.warn(
      { raffleId: raffle.id, banner, error: sent.description },
      "Telegram raffle banner failed, posting without the image",
    );
    sent = null;
  }

  if (!sent) {
    sent = await sendToCommunity(
      token,
      community.telegramChatId,
      raffleTopicId,
      post,
    );
  }

  if (!sent.ok || !sent.result) {
    throw new Error(sent.description ?? "Telegram raffle delivery failed");
  }
  await prisma.telegramRafflePublication.update({
    where: { id: publication.id },
    data: { telegramMessageId: String(sent.result.message_id) },
  });
}

async function deliverWinners(input: {
  botToken: string;
  chatId: string;
  topicId: number | null;
  raffle: {
    id: number;
    projectName: string;
    title: string;
    winners: { userId: string; username: string; position: number }[];
  };
  visibility: TelegramWinnerVisibility;
  url: string;
}): Promise<void> {
  const identities =
    input.visibility === "PUBLIC" && input.raffle.winners.length
      ? await prisma.connectedAccount.findMany({
          where: {
            provider: "TELEGRAM",
            userId: { in: input.raffle.winners.map((winner) => winner.userId) },
          },
          select: { userId: true, handle: true, displayName: true },
        })
      : [];
  const identityByUser = new Map(
    identities.map((identity) => [identity.userId, identity]),
  );
  let winners = "Results are available to authorized KOS administrators.";
  if (input.visibility === "ANONYMOUS") {
    winners = input.raffle.winners.length
      ? input.raffle.winners
          .map((winner) => `Winner ${winner.position}`)
          .join("\n")
      : "No eligible winners were drawn.";
  } else if (input.visibility === "PUBLIC") {
    winners = input.raffle.winners.length
      ? input.raffle.winners
          .map((winner) => {
            const identity = identityByUser.get(winner.userId);
            const label = identity?.handle
              ? `@${identity.handle}`
              : identity?.displayName || winner.username;
            return `${winner.position}. ${escapeHtml(label)}`;
          })
          .join("\n")
      : "No eligible winners were drawn.";
  }
  const response = await sendToCommunity(
    input.botToken,
    input.chatId,
    input.topicId,
    {
      parse_mode: "HTML",
      text: `<b>RAFFLE RESULTS</b>\n\n${escapeHtml(input.raffle.projectName)}\n\n${winners}`,
      reply_markup: {
        inline_keyboard: [[{ text: "View results", url: input.url }]],
      },
      disable_web_page_preview: true,
    },
  );
  if (!response.ok)
    throw new Error(response.description ?? "Telegram winner delivery failed");
}

export async function processTelegramDeliveries(
  now: Date,
  batchSize: number,
): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  await prisma.integrationDelivery.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
    },
    data: { status: "PENDING", lockedAt: null },
  });
  const due = await prisma.integrationDelivery.findMany({
    where: { status: "PENDING", notBefore: { lte: now } },
    orderBy: [{ notBefore: "asc" }, { createdAt: "asc" }],
    take: batchSize,
    select: { id: true, attempts: true, event: true },
  });
  for (const delivery of due) {
    const claim = await prisma.integrationDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 0) continue;
    try {
      await deliverRaffleMessage(delivery.id);
      await prisma.integrationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      const terminal = attempts >= 8;
      await prisma.integrationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          lockedAt: null,
          lastError: message,
          notBefore: new Date(
            Date.now() + Math.min(30 * 60_000, 2 ** attempts * 15_000),
          ),
        },
      });
      logger.warn(
        {
          deliveryId: delivery.id,
          event: delivery.event,
          attempts,
          error: message,
        },
        terminal
          ? "Telegram delivery exhausted retries"
          : "Telegram delivery will retry",
      );
    }
  }
}
