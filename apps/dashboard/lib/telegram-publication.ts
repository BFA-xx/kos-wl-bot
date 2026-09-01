import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { TelegramWinnerVisibility } from "@prisma/client";

export async function publishRaffleToTelegram(input: {
  raffleId: number;
  communityId: string;
  actorId: string;
  membershipRequired: boolean;
  remainUntilEnd: boolean;
  autoAnnouncements: boolean;
  winnerVisibility: TelegramWinnerVisibility;
}) {
  const marker = randomUUID();
  return prisma.$transaction(async (tx) => {
    const raffle = await tx.raffle.findUniqueOrThrow({
      where: { id: input.raffleId },
      select: { id: true, endAt: true },
    });
    const community = await tx.telegramCommunity.findUniqueOrThrow({
      where: { id: input.communityId },
      select: { id: true, telegramChatId: true, communityName: true },
    });
    const publication = await tx.telegramRafflePublication.upsert({
      where: {
        raffleId_communityId: {
          raffleId: input.raffleId,
          communityId: input.communityId,
        },
      },
      create: {
        raffleId: input.raffleId,
        communityId: input.communityId,
        createdById: input.actorId,
        autoAnnouncements: input.autoAnnouncements,
        winnerVisibility: input.winnerVisibility,
      },
      update: {
        autoAnnouncements: input.autoAnnouncements,
        winnerVisibility: input.winnerVisibility,
      },
    });

    await tx.integrationActionToken.upsert({
      where: { publicationId: publication.id },
      create: {
        action: "TELEGRAM_ENTER",
        publicationId: publication.id,
        singleUse: false,
        expiresAt: new Date(raffle.endAt.getTime() + 86_400_000),
      },
      update: {
        expiresAt: new Date(raffle.endAt.getTime() + 86_400_000),
        consumedAt: null,
      },
    });

    await tx.raffleEligibilityRule.deleteMany({
      where: { publicationId: publication.id },
    });
    if (input.membershipRequired) {
      await tx.raffleEligibilityRule.create({
        data: {
          raffleId: input.raffleId,
          publicationId: publication.id,
          provider: "TELEGRAM",
          type: "TELEGRAM_CHAT_MEMBER",
          checkAt: input.remainUntilEnd ? "BOTH" : "ENTRY",
          config: {
            chatId: community.telegramChatId,
            chatName: community.communityName,
          },
        },
      });
    }

    await tx.integrationDelivery.create({
      data: {
        event: "RAFFLE_CREATED",
        communityId: community.id,
        publicationId: publication.id,
        raffleId: raffle.id,
        dedupeKey: `telegram:RAFFLE_CREATED:${publication.id}:${marker}`,
      },
    });
    const reminderAt = new Date(raffle.endAt.getTime() - 10 * 60_000);
    if (input.autoAnnouncements && reminderAt.getTime() > Date.now()) {
      await tx.integrationDelivery.create({
        data: {
          event: "RAFFLE_ENDING_SOON",
          communityId: community.id,
          publicationId: publication.id,
          raffleId: raffle.id,
          dedupeKey: `telegram:RAFFLE_ENDING_SOON:${publication.id}:${marker}`,
          notBefore: reminderAt,
        },
      });
    }
    return publication;
  });
}
