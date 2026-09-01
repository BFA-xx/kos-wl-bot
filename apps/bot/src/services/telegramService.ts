import {
  callTelegramApi,
  IntegrationDeliveryEvent,
  prisma,
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
  const url = raffleUrl({
    id: raffle.id,
    projectName: raffle.projectName,
    organizationSlug: community.organization.slug,
  });

  if (delivery.event === "RAFFLE_ENDING_SOON") {
    if (raffle.status !== "LIVE" || raffle.endAt <= new Date()) return;
    const response = await callTelegramApi<TelegramMessage>(
      token,
      "sendMessage",
      {
        chat_id: community.telegramChatId,
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
  const body = {
    chat_id: community.telegramChatId,
    message_id: publication.telegramMessageId
      ? Number(publication.telegramMessageId)
      : undefined,
    parse_mode: "HTML",
    text: lines.join("\n"),
    reply_markup: { inline_keyboard: keyboard },
    disable_web_page_preview: true,
  };

  if (publication.telegramMessageId) {
    const edited = await callTelegramApi<true>(token, "editMessageText", body);
    if (edited.ok || edited.description?.includes("message is not modified"))
      return;
  }
  const sent = await callTelegramApi<TelegramMessage>(token, "sendMessage", {
    ...body,
    message_id: undefined,
  });
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
  const response = await callTelegramApi<TelegramMessage>(
    input.botToken,
    "sendMessage",
    {
      chat_id: input.chatId,
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
