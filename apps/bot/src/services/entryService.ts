import { type GuildMember } from "discord.js";
import {
  prisma,
  LogCategory,
  Prisma,
  RaffleStatus,
  type WalletChain,
} from "@kos/db";
import { createHash } from "node:crypto";
import {
  evaluateEligibility,
  parseRequirements,
} from "./eligibilityService.js";
import { upsertUser } from "./userService.js";
import { audit } from "./auditService.js";
import { logger } from "../logger.js";
import { awardTaskPoints } from "./pointsService.js";

export type EnterOutcome =
  | {
      status: "entered";
      entryCount: number;
      missingWalletChains: WalletChain[];
    }
  | { status: "duplicate" }
  | { status: "ineligible"; reasons: string[] }
  | { status: "no_wallet"; chains: WalletChain[] }
  | { status: "tasks_incomplete"; missing: string[] }
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

  // Hard wallet gate: must have a registered wallet for one of the chains.
  if (raffle.requireWallet && raffle.walletChains.length > 0) {
    const have = await prisma.walletProfile.count({
      where: { userId: member.id, chain: { in: raffle.walletChains } },
    });
    if (have === 0) return { status: "no_wallet", chains: raffle.walletChains };
  }

  // Task Engine gate: all required verification tasks must be VERIFIED.
  const missingTasks = await checkRequiredTasks(
    raffle.id,
    member,
    raffle.requirements,
  );
  if (missingTasks.length > 0) {
    return { status: "tasks_incomplete", missing: missingTasks };
  }

  await upsertUser({
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarUrl: member.user.displayAvatarURL(),
  });

  try {
    const weight = await entryWeightForMember(raffle, member);
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
          weight,
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
      metadata: eligibility.flags.length
        ? { flags: eligibility.flags }
        : undefined,
    });

    // Which of the raffle's wallet chains does this user still need to register?
    let missingWalletChains: WalletChain[] = [];
    if (raffle.collectWallets && raffle.walletChains.length > 0) {
      const have = await prisma.walletProfile.findMany({
        where: { userId: member.id, chain: { in: raffle.walletChains } },
        select: { chain: true },
      });
      const haveSet = new Set(have.map((p) => p.chain));
      missingWalletChains = raffle.walletChains.filter((c) => !haveSet.has(c));
    }

    return { status: "entered", entryCount, missingWalletChains };
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

async function entryWeightForMember(
  raffle: { guildId: string; useRoleWeights: boolean },
  member: GuildMember,
): Promise<number> {
  if (!raffle.useRoleWeights) return 1;
  const roleIds = [...member.roles.cache.keys()];
  if (roleIds.length === 0) return 1;
  const conn = await prisma.guildConnection.findUnique({
    where: { guildId: raffle.guildId },
    select: { organizationId: true },
  });
  if (!conn) return 1;
  const weights = await prisma.roleWeight.findMany({
    where: {
      organizationId: conn.organizationId,
      guildId: raffle.guildId,
      roleId: { in: roleIds },
    },
    select: { multiplier: true },
  });
  return Math.max(
    1,
    ...weights.map((w) => Math.max(1, Math.min(100, w.multiplier))),
  );
}

/**
 * Task Engine gate (Phase 3). Returns the titles of REQUIRED verification
 * tasks the user hasn't completed. Discord tasks are auto-verified inline —
 * the bot is holding the member object, so join/role checks are free — which
 * means a raffle gated only on Discord tasks needs zero dashboard round-trip.
 */
async function checkRequiredTasks(
  raffleId: number,
  member: GuildMember,
  requirements: unknown,
): Promise<string[]> {
  const links = await prisma.raffleTask.findMany({
    where: { raffleId, required: true, task: { active: true } },
    include: { task: true },
  });
  const missing: string[] = [];

  if (links.length > 0) {
    const completions = await prisma.taskCompletion.findMany({
      where: { userId: member.id, taskId: { in: links.map((l) => l.taskId) } },
      select: { taskId: true, status: true },
    });
    const statusByTask = new Map(completions.map((c) => [c.taskId, c.status]));

    for (const { task } of links) {
      if (statusByTask.get(task.id) === "VERIFIED") {
        await awardTaskPoints({
          organizationId: task.organizationId,
          userId: member.id,
          taskId: task.id,
          taskTitle: task.title,
          points: task.points,
        });
        continue;
      }

      // Inline auto-verify for Discord tasks in THIS guild.
      const cfg = (task.config ?? {}) as { guildId?: string; roleId?: string };
      const inThisGuild = cfg.guildId === member.guild.id;
      const passes =
        inThisGuild &&
        (task.type === "DISCORD_JOIN" ||
          (task.type === "DISCORD_ROLE" &&
            cfg.roleId &&
            member.roles.cache.has(cfg.roleId)));

      if (passes) {
        await prisma.taskCompletion
          .upsert({
            where: { taskId_userId: { taskId: task.id, userId: member.id } },
            create: {
              taskId: task.id,
              userId: member.id,
              status: "VERIFIED",
              verifiedAt: new Date(),
              evidence: {
                method: "bot_inline_check",
                guildId: cfg.guildId,
                at: new Date().toISOString(),
              },
            },
            update: {
              status: "VERIFIED",
              verifiedAt: new Date(),
              evidence: {
                method: "bot_inline_check",
                guildId: cfg.guildId,
                at: new Date().toISOString(),
              },
            },
          })
          .catch(() => undefined);
        await awardTaskPoints({
          organizationId: task.organizationId,
          userId: member.id,
          taskId: task.id,
          taskTitle: task.title,
          points: task.points,
        });
        continue;
      }

      missing.push(task.title);
    }
  }

  const legacyTasks = legacySocialTasks(raffleId, requirements);
  if (legacyTasks.length > 0) {
    const logs = await prisma.log.findMany({
      where: {
        raffleId,
        actorId: member.id,
        action: "SOCIAL_TASK_VERIFY",
      },
      select: { metadata: true },
    });
    const done = new Set(
      logs.flatMap((log) => {
        const key = ((log.metadata ?? {}) as { taskKey?: unknown }).taskKey;
        return typeof key === "string" ? [key] : [];
      }),
    );
    for (const task of legacyTasks) {
      if (!done.has(task.key)) missing.push(task.label);
    }
  }

  return missing;
}

function legacySocialTasks(raffleId: number, requirements: unknown) {
  const tasks = parseRequirements(requirements).tasks ?? [];
  return tasks.flatMap((task, index) => {
    if (!task.label.trim()) return [];
    const url = task.url?.trim() || null;
    const hash = createHash("sha1")
      .update(`${task.label.trim()}\n${url ?? ""}`)
      .digest("hex")
      .slice(0, 12);
    return [
      { label: task.label.trim(), key: `legacy:${raffleId}:${index}:${hash}` },
    ];
  });
}
