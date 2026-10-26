import { type Prisma, RaffleStatus } from "@kos/db";

/** How long after its start a raffle's missed ping is still worth sending. */
export const START_PING_RETRY_WINDOW_MS = 30 * 60_000;
/** Minimum gap between re-post attempts for the same raffle. */
export const START_PING_RETRY_INTERVAL_MS = 60_000;

/**
 * LIVE raffles that already have a post but whose start ping never went out.
 * The window keeps raffles from before startPinged existed (and long-dead
 * channels) from being pinged or retried indefinitely.
 */
export function missedStartPingWhere(now: Date): Prisma.RaffleWhereInput {
  return {
    status: RaffleStatus.LIVE,
    startPinged: false,
    startPing: { not: "none" },
    messageId: { not: null },
    channelId: { not: null },
    startAt: { gte: new Date(now.getTime() - START_PING_RETRY_WINDOW_MS) },
    endAt: { gt: now },
  };
}
