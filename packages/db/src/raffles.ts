import type { PrismaClient } from "@prisma/client";

export interface RecordRaffleParticipantInput {
  raffleId: number;
  userId: string;
  username: string;
  accountCreatedAt?: Date | null;
  joinedGuildAt?: Date | null;
  flagged?: boolean;
  flagReason?: string | null;
  weight?: number;
  requestMessageRefresh?: boolean;
}

export interface RaffleParticipantMutation {
  changed: boolean;
  entryCount: number | null;
}

/**
 * The authoritative participant insert and counter mutation shared by every
 * interaction surface. Provider adapters own eligibility and side effects.
 */
export async function recordRaffleParticipant(
  db: PrismaClient,
  input: RecordRaffleParticipantInput,
): Promise<RaffleParticipantMutation> {
  const entryCount = await db.$transaction(async (tx) => {
    const inserted = await tx.participant.createMany({
      data: [
        {
          raffleId: input.raffleId,
          userId: input.userId,
          username: input.username,
          accountCreatedAt: input.accountCreatedAt ?? null,
          joinedGuildAt: input.joinedGuildAt ?? null,
          flagged: input.flagged ?? false,
          flagReason: input.flagReason ?? null,
          weight: Math.max(1, Math.min(100, input.weight ?? 1)),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) return null;
    const updated = await tx.raffle.update({
      where: { id: input.raffleId },
      data: {
        entryCount: { increment: 1 },
        ...(input.requestMessageRefresh ? { editRequestedAt: new Date() } : {}),
      },
      select: { entryCount: true },
    });
    return updated.entryCount;
  });
  return { changed: entryCount !== null, entryCount };
}

/** Shared participant removal with a counter floor guard. */
export async function removeRaffleParticipant(
  db: PrismaClient,
  input: {
    raffleId: number;
    userId: string;
    requestMessageRefresh?: boolean;
  },
): Promise<RaffleParticipantMutation> {
  const entryCount = await db.$transaction(async (tx) => {
    const removed = await tx.participant.deleteMany({
      where: { raffleId: input.raffleId, userId: input.userId },
    });
    if (removed.count === 0) return null;
    const raffle = await tx.raffle.findUniqueOrThrow({
      where: { id: input.raffleId },
      select: { entryCount: true },
    });
    const updated = await tx.raffle.update({
      where: { id: input.raffleId },
      data: {
        entryCount: Math.max(0, raffle.entryCount - 1),
        ...(input.requestMessageRefresh ? { editRequestedAt: new Date() } : {}),
      },
      select: { entryCount: true },
    });
    return updated.entryCount;
  });
  return { changed: entryCount !== null, entryCount };
}
