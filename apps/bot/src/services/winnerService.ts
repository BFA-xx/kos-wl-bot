import { type Client } from "discord.js";
import { prisma, LogCategory, RaffleStatus } from "@kos/db";
import {
  verifiableSample,
  verifiableWeightedSample,
  generateDrawSeed,
} from "../utils/random.js";
import {
  buildWinnerEmbed,
  buildWinnerMentions,
} from "../embeds/winnerEmbed.js";
import {
  getRaffle,
  fetchTextChannel,
  refreshRaffleMessage,
} from "./raffleService.js";
import { dmWinnersForWallets } from "./walletService.js";
import { isBlacklisted } from "./blacklistService.js";
import { audit } from "./auditService.js";
import { generateAndDeliverProof } from "./proofService.js";
import { logger } from "../logger.js";

interface DrawnWinner {
  userId: string;
  username: string;
  participantId: number;
  weight: number;
}

/**
 * Close a raffle and draw winners. Idempotent: if the raffle is already
 * ENDED/CANCELLED it does nothing. Runs the full completion pipeline:
 * draw → persist → announce → wallet DMs → proof.
 */
export async function closeAndDraw(
  client: Client,
  raffleId: number,
  actorId?: string,
): Promise<void> {
  const raffle = await getRaffle(raffleId);
  if (!raffle) return;
  if (
    raffle.status === RaffleStatus.ENDED ||
    raffle.status === RaffleStatus.CANCELLED
  ) {
    return;
  }

  // Eligible pool = entered users who are not currently blacklisted.
  const participants = await prisma.participant.findMany({
    where: { raffleId },
    select: { id: true, userId: true, username: true, weight: true },
  });
  const pool: DrawnWinner[] = [];
  for (const p of participants) {
    if (await isBlacklisted(raffle.guildId, p.userId)) continue;
    pool.push({
      userId: p.userId,
      username: p.username,
      participantId: p.id,
      weight: p.weight,
    });
  }

  const { seed, hash } = generateDrawSeed();
  const drawn = raffle.useRoleWeights
    ? verifiableWeightedSample(
        pool,
        raffle.spots,
        seed,
        (p) => p.userId,
        (p) => p.weight,
      )
    : verifiableSample(pool, raffle.spots, seed, (p) => p.userId);

  const endedAt =
    raffle.endAt.getTime() < Date.now() ? raffle.endAt : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.raffle.update({
      where: { id: raffleId },
      data: {
        status: RaffleStatus.ENDED,
        endedAt,
        drawnAt: new Date(),
        drawSeed: seed,
        drawSeedHash: hash,
      },
    });
    if (drawn.length > 0) {
      await tx.winner.createMany({
        data: drawn.map((w, i) => ({
          raffleId,
          userId: w.userId,
          username: w.username,
          position: i + 1,
          participantId: w.participantId,
        })),
      });
    }
  });

  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.WINNER,
    action: "RAFFLE_DRAW",
    message: `Drew ${drawn.length} winner(s) from ${pool.length} eligible entries`,
    actorId: actorId ?? null,
    metadata: {
      drawSeedHash: hash,
      spots: raffle.spots,
      weighted: raffle.useRoleWeights,
      totalWeight: pool.reduce((sum, p) => sum + Math.max(1, p.weight), 0),
    },
  });

  // Web-parity notifications: winners get a WIN, other entrants a RESULT.
  await notifyRaffleResults(
    raffleId,
    raffle.guildId,
    raffle.projectName,
    drawn,
    participants,
  ).catch((err) =>
    logger.warn({ err, raffleId }, "result notifications failed"),
  );

  // Lock the live embed (buttons disabled, status ENDED).
  await refreshRaffleMessage(client, raffleId).catch(() => undefined);

  // Announce winners.
  const messageLink = await announceWinners(client, raffleId, drawn);

  // Wallet collection DMs.
  if (raffle.collectWallets && drawn.length > 0) {
    await dmWinnersForWallets(client, raffle, drawn).catch((err) =>
      logger.warn({ err, raffleId }, "wallet DM step failed"),
    );
  }

  // Proof generation + delivery.
  await generateAndDeliverProof(client, raffleId, messageLink).catch((err) =>
    logger.error({ err, raffleId }, "proof generation failed"),
  );
}

/**
 * Create in-app notifications for a completed draw (shown in the website's
 * bell). Winners get a WIN; everyone else who entered gets a RESULT. Links go
 * to the community's public raffle page when the guild is connected to an org.
 */
async function notifyRaffleResults(
  raffleId: number,
  guildId: string,
  projectName: string,
  winners: { userId: string }[],
  participants: { userId: string }[],
): Promise<void> {
  const conn = await prisma.guildConnection.findUnique({
    where: { guildId },
    include: { organization: { select: { slug: true } } },
  });
  const link = conn ? `/r/${raffleId}` : "/me/history";

  const winnerIds = new Set(winners.map((w) => w.userId));
  const losers = participants.filter((p) => !winnerIds.has(p.userId));

  await prisma.notification.createMany({
    data: [
      ...winners.map((w) => ({
        userId: w.userId,
        type: "WIN",
        title: `You won ${projectName}! 🎉`,
        body: "Congratulations — check the raffle for details and make sure your wallet is registered.",
        link,
      })),
      ...losers.map((p) => ({
        userId: p.userId,
        type: "RESULT",
        title: `Results are in for ${projectName}`,
        body: "Winners have been drawn — better luck next time.",
        link,
      })),
    ],
  });
}

async function announceWinners(
  client: Client,
  raffleId: number,
  winners: { userId: string; username: string }[],
): Promise<string | null> {
  const raffle = await getRaffle(raffleId);
  if (!raffle) return null;
  const channelId = raffle.announceChannelId ?? raffle.channelId;
  if (!channelId) return null;

  const channel = await fetchTextChannel(client, channelId);
  if (!channel) return null;

  const connection = await prisma.guildConnection.findUnique({
    where: { guildId: raffle.guildId },
    select: { organization: { select: { name: true } } },
  });
  const communityName = connection?.organization.name ?? channel.guild.name;

  const embed = buildWinnerEmbed({
    id: raffle.id,
    communityName,
    projectName: raffle.projectName,
    title: raffle.title,
    spots: raffle.spots,
    entryCount: raffle.hideEntries ? undefined : raffle.entryCount,
    endedAt: raffle.endedAt ?? new Date(),
    winners,
    drawSeedHash: raffle.drawSeedHash,
  });

  const message = await channel
    .send({
      content: buildWinnerMentions(winners) || undefined,
      embeds: [embed],
      allowedMentions: { users: winners.map((w) => w.userId) },
    })
    .catch((err) => {
      logger.warn({ err, raffleId }, "winner announcement failed");
      return null;
    });

  return message
    ? `https://discord.com/channels/${raffle.guildId}/${channel.id}/${message.id}`
    : null;
}

export type RerollMode = "single" | "multiple" | "all";

export interface RerollOptions {
  mode: RerollMode;
  /** For single/multiple: the user ids of winners to replace. */
  userIds?: string[];
  /** For multiple: number of random winners to replace if no userIds given. */
  count?: number;
}

export interface RerollResult {
  replaced: { userId: string; username: string }[];
  added: { userId: string; username: string }[];
}

/** Reroll some or all winners, drawing replacements from non-winning entrants. */
export async function rerollWinners(
  client: Client,
  raffleId: number,
  actorId: string,
  options: RerollOptions,
): Promise<RerollResult | null> {
  const raffle = await getRaffle(raffleId);
  if (!raffle || raffle.status !== RaffleStatus.ENDED) return null;

  const currentWinners = await prisma.winner.findMany({
    where: { raffleId, replaced: false },
    orderBy: { position: "asc" },
  });
  if (currentWinners.length === 0) return null;

  // Decide which winners to replace.
  let toReplace = currentWinners;
  if (options.mode === "single" || options.mode === "multiple") {
    if (options.userIds?.length) {
      const set = new Set(options.userIds);
      toReplace = currentWinners.filter((w) => set.has(w.userId));
    } else if (options.count) {
      toReplace = currentWinners.slice(0, options.count);
    }
  }
  if (toReplace.length === 0) return null;

  // Eligible replacements: entrants who aren't current winners and not blacklisted.
  const winnerIds = new Set(currentWinners.map((w) => w.userId));
  const participants = await prisma.participant.findMany({
    where: { raffleId },
    select: { id: true, userId: true, username: true, weight: true },
  });
  const pool: DrawnWinner[] = [];
  for (const p of participants) {
    if (winnerIds.has(p.userId)) continue;
    if (await isBlacklisted(raffle.guildId, p.userId)) continue;
    pool.push({
      userId: p.userId,
      username: p.username,
      participantId: p.id,
      weight: p.weight,
    });
  }

  const { seed } = generateDrawSeed();
  const replacements = raffle.useRoleWeights
    ? verifiableWeightedSample(
        pool,
        toReplace.length,
        seed,
        (p) => p.userId,
        (p) => p.weight,
      )
    : verifiableSample(pool, toReplace.length, seed, (p) => p.userId);

  const added: { userId: string; username: string }[] = [];
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < toReplace.length; i++) {
      const old = toReplace[i]!;
      await tx.winner.update({
        where: { id: old.id },
        data: { replaced: true },
      });
      const repl = replacements[i];
      if (!repl) continue; // pool exhausted
      await tx.winner.create({
        data: {
          raffleId,
          userId: repl.userId,
          username: repl.username,
          position: old.position,
          participantId: repl.participantId,
          fromReroll: true,
        },
      });
      added.push({ userId: repl.userId, username: repl.username });
    }
  });

  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.REROLL,
    action: "RAFFLE_REROLL",
    message: `Rerolled ${toReplace.length} winner(s) (${options.mode})`,
    actorId,
    metadata: {
      removed: toReplace.map((w) => w.userId),
      added: added.map((w) => w.userId),
      weighted: raffle.useRoleWeights,
      totalWeight: pool.reduce((sum, p) => sum + Math.max(1, p.weight), 0),
    },
  });

  // Notify freshly drawn replacement winners on the web too.
  if (added.length > 0) {
    await notifyRaffleResults(
      raffleId,
      raffle.guildId,
      raffle.projectName,
      added,
      [],
    ).catch((err) =>
      logger.warn({ err, raffleId }, "reroll notifications failed"),
    );
  }

  // Announce reroll + wallet DM new winners + refresh proof.
  if (added.length > 0) {
    const channelId = raffle.announceChannelId ?? raffle.channelId;
    const channel = channelId
      ? await fetchTextChannel(client, channelId)
      : null;
    if (channel) {
      await channel
        .send({
          content: `🔁 **Reroll** — new winner(s): ${added
            .map((w) => `<@${w.userId}>`)
            .join(" ")}`,
          allowedMentions: { users: added.map((w) => w.userId) },
        })
        .catch(() => undefined);
    }
    if (raffle.collectWallets) {
      await dmWinnersForWallets(client, raffle, added).catch(() => undefined);
    }
  }

  await generateAndDeliverProof(client, raffleId, null).catch((err) =>
    logger.warn({ err, raffleId }, "proof refresh after reroll failed"),
  );

  return {
    replaced: toReplace.map((w) => ({
      userId: w.userId,
      username: w.username,
    })),
    added,
  };
}
