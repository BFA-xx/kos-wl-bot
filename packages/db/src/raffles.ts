import type { Prisma, PrismaClient } from "@prisma/client";

export type RerollOptions =
  | { mode: "manual"; winnerUserId: string; replacementUserId: string }
  | { mode: "single" | "multiple" | "all"; userIds?: string[]; count?: number };

export function parseRerollOptions(input: unknown): RerollOptions | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const {
    mode = "all",
    winnerUserId,
    replacementUserId,
    userIds,
    count,
  } = input as Record<string, unknown>;
  const isUserId = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 128;

  if (mode === "manual") {
    if (
      !isUserId(winnerUserId) ||
      !isUserId(replacementUserId) ||
      winnerUserId === replacementUserId
    ) {
      return null;
    }
    return { mode, winnerUserId, replacementUserId };
  }
  if (mode !== "single" && mode !== "multiple" && mode !== "all") return null;
  if (
    userIds !== undefined &&
    (!Array.isArray(userIds) || !userIds.every(isUserId))
  )
    return null;
  if (
    count !== undefined &&
    (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1)
  )
    return null;
  return { mode, userIds, count };
}

/** Replacements must have entered and cannot have already won this raffle. */
export function raffleReplacementWhere(
  raffleId: number,
  guildId: string,
): Prisma.ParticipantWhereInput {
  return {
    raffleId,
    user: {
      winners: { none: { raffleId } },
      blacklists: { none: { guildId } },
    },
  };
}

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

/** Held winners stay private until the team has explicitly published them. */
export function raffleResultsVisible(raffle: {
  holdResults: boolean;
  resultsPublishedAt: Date | null;
}): boolean {
  return !raffle.holdResults || raffle.resultsPublishedAt !== null;
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
