import { type GuildMember } from "discord.js";
import { prisma, LogCategory, Prisma, RaffleStatus } from "@kos/db";
import { evaluateEligibility } from "./eligibilityService.js";
import { upsertUser } from "./userService.js";
import { audit } from "./auditService.js";
import { logger } from "../logger.js";

export type EnterOutcome =
  | { status: "entered"; entryCount: number }
  | { status: "duplicate" }
  | { status: "ineligible"; reasons: string[] }
  | { status: "closed" }
  | { status: "error" };

export type LeaveOutcome =
  | { status: "left"; entryCount: number }
  | { status: "not_entered" }
  | { status: "closed" }
  | { status: "error" };

/**
 * Attempt to enter `member` into the raffle. Verifies the raffle is LIVE,
 * checks eligibility + blacklist, prevents duplicates, and records an entry
 * snapshot — all inside a transaction so entryCount stays consistent.
 */
export async function enterRaffle(
  raffleId: number,
  member: GuildMember,
): Promise<EnterOutcome> {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    include: { eligibleRoles: true },
  });
  if (!raffle) return { status: "error" };
  if (raffle.status !== RaffleStatus.LIVE) return { status: "closed" };

  const eligibility = await evaluateEligibility(member, raffle);
  if (!eligibility.eligible) {
    return { status: "ineligible", reasons: eligibility.reasons };
  }

  await upsertUser({
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarUrl: member.user.displayAvatarURL(),
  });

  try {
    const entryCount = await prisma.$transaction(async (tx) => {
      await tx.participant.create({
        data: {
          raffleId,
          userId: member.id,
          username: member.user.username,
          accountCreatedAt: new Date(member.user.createdTimestamp),
          joinedGuildAt: member.joinedTimestamp
            ? new Date(member.joinedTimestamp)
            : null,
          flagged: eligibility.flags.length > 0,
          flagReason: eligibility.flags.length
            ? eligibility.flags.join(", ")
            : null,
        },
      });
      const updated = await tx.raffle.update({
        where: { id: raffleId },
        data: { entryCount: { increment: 1 } },
        select: { entryCount: true },
      });
      return updated.entryCount;
    });

    await audit({
      guildId: raffle.guildId,
      raffleId,
      category: LogCategory.ENTRY,
      action: "ENTRY_ADD",
      message: `${member.user.username} entered raffle #${raffleId}`,
      actorId: member.id,
      metadata: eligibility.flags.length ? { flags: eligibility.flags } : undefined,
    });

    return { status: "entered", entryCount };
  } catch (err) {
    // Unique violation = already entered (race-safe duplicate guard).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { status: "duplicate" };
    }
    logger.error({ err, raffleId, userId: member.id }, "enterRaffle failed");
    return { status: "error" };
  }
}

/** Remove `member`'s entry from a LIVE raffle. */
export async function leaveRaffle(
  raffleId: number,
  member: GuildMember,
): Promise<LeaveOutcome> {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { status: true, guildId: true },
  });
  if (!raffle) return { status: "error" };
  if (raffle.status !== RaffleStatus.LIVE) return { status: "closed" };

  try {
    const entryCount = await prisma.$transaction(async (tx) => {
      const existing = await tx.participant.findUnique({
        where: { raffleId_userId: { raffleId, userId: member.id } },
        select: { id: true },
      });
      if (!existing) return null;

      await tx.participant.delete({ where: { id: existing.id } });
      const updated = await tx.raffle.update({
        where: { id: raffleId },
        data: { entryCount: { decrement: 1 } },
        select: { entryCount: true },
      });
      return updated.entryCount;
    });

    if (entryCount === null) return { status: "not_entered" };

    await audit({
      guildId: raffle.guildId,
      raffleId,
      category: LogCategory.ENTRY,
      action: "ENTRY_REMOVE",
      message: `${member.user.username} left raffle #${raffleId}`,
      actorId: member.id,
    });

    return { status: "left", entryCount };
  } catch (err) {
    logger.error({ err, raffleId, userId: member.id }, "leaveRaffle failed");
    return { status: "error" };
  }
}
