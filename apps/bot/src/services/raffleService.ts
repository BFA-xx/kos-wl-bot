import {
  type Client,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  prisma,
  LogCategory,
  RaffleStatus,
  RoleMatchMode,
  WalletChain,
  Prisma,
} from "@kos/db";
import {
  buildRaffleEmbed,
  buildRaffleComponents,
} from "../embeds/raffleEmbed.js";
import { audit } from "./auditService.js";
import { ensureGuild } from "./userService.js";
import { logger } from "../logger.js";
import type { EntryRequirements } from "../types.js";
import { ensureCollaborationForRaffle } from "./collaborationService.js";
import { persistDiscordRaffleBanner } from "./raffleBannerService.js";

export interface CreateRaffleInput {
  guildId: string;
  createdById: string;
  createdByName: string;
  createdByAvatar: string | null;
  projectName: string;
  title: string;
  description: string | null;
  spots: number;
  roleMatchMode: RoleMatchMode;
  startAt: Date;
  endAt: Date;
  channelId: string;
  announceChannelId: string;
  proofChannelId: string;
  bannerUrl?: string | null;
  externalUrl?: string | null;
  requirements?: EntryRequirements | null;
  collectWallets: boolean;
  walletChains: WalletChain[];
  hideEntries: boolean;
  requireWallet: boolean;
  startPing: string;
  roles: { roleId: string; roleName: string }[];
}

const raffleInclude = { eligibleRoles: true } satisfies Prisma.RaffleInclude;

export type RaffleWithRoles = Prisma.RaffleGetPayload<{
  include: typeof raffleInclude;
}>;

export async function getRaffle(id: number): Promise<RaffleWithRoles | null> {
  return prisma.raffle.findUnique({ where: { id }, include: raffleInclude });
}

export async function createRaffle(
  input: CreateRaffleInput,
): Promise<RaffleWithRoles> {
  await ensureGuild({ id: input.guildId });

  const now = new Date();
  const status =
    input.startAt.getTime() <= now.getTime()
      ? RaffleStatus.LIVE
      : RaffleStatus.UPCOMING;

  const raffle = await prisma.raffle.create({
    data: {
      guildId: input.guildId,
      createdById: input.createdById,
      createdByName: input.createdByName,
      createdByAvatar: input.createdByAvatar,
      projectName: input.projectName,
      title: input.title,
      description: input.description,
      spots: input.spots,
      roleMatchMode: input.roleMatchMode,
      status,
      startAt: input.startAt,
      endAt: input.endAt,
      channelId: input.channelId,
      announceChannelId: input.announceChannelId,
      proofChannelId: input.proofChannelId,
      bannerUrl: input.bannerUrl ?? null,
      externalUrl: input.externalUrl ?? null,
      requirements: input.requirements
        ? (input.requirements as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      collectWallets: input.collectWallets,
      walletChains: input.walletChains,
      hideEntries: input.hideEntries,
      requireWallet: input.requireWallet,
      startPing: input.startPing,
      eligibleRoles: { create: input.roles },
    },
    include: raffleInclude,
  });

  await audit({
    guildId: input.guildId,
    raffleId: raffle.id,
    category: LogCategory.RAFFLE,
    action: "RAFFLE_CREATE",
    message: `Created raffle #${raffle.id} "${raffle.title}" for ${raffle.projectName} (${raffle.spots} spots)`,
    actorId: input.createdById,
  });

  return raffle;
}

export interface PublishResult {
  ok: boolean;
  reason?: string;
}

/**
 * Post the live raffle embed to its channel and store the message id.
 * Returns { ok, reason } so callers can surface the exact problem.
 */
export async function publishRaffleMessage(
  client: Client,
  raffleId: number,
): Promise<PublishResult> {
  let raffle = await getRaffle(raffleId);
  if (!raffle || !raffle.channelId) {
    return { ok: false, reason: "no target channel set" };
  }

  const channel = await fetchTextChannel(client, raffle.channelId);
  if (!channel) {
    logger.warn(
      { raffleId, channelId: raffle.channelId },
      "raffle channel not found / not text",
    );
    return {
      ok: false,
      reason: "I can't see that channel (or it isn't a text channel).",
    };
  }

  // Make sure the bot's member object is cached so the permission check is real.
  const me =
    channel.guild.members.me ??
    (await channel.guild.members.fetchMe().catch(() => null));
  const missing = missingPostPermissions(channel, me);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `I'm missing **${missing.join(", ")}** in <#${channel.id}>.`,
    };
  }

  if (raffle.bannerUrl) {
    try {
      const bannerUrl = await persistDiscordRaffleBanner(
        raffleId,
        raffle.bannerUrl,
      );
      if (bannerUrl !== raffle.bannerUrl) raffle = { ...raffle, bannerUrl };
    } catch (error) {
      logger.warn({ error, raffleId }, "raffle banner persistence failed");
      return {
        ok: false,
        reason:
          "I couldn't store that Discord banner safely. Re-attach the image and try again.",
      };
    }
  }

  try {
    const content = startMentionContent(raffle);
    const message = await channel.send({
      content: content || undefined,
      embeds: [buildRaffleEmbed(raffle)],
      components: buildRaffleComponents(raffle),
      allowedMentions: { parse: content ? ["everyone"] : [] },
    });
    await prisma.raffle.update({
      where: { id: raffleId },
      data: { messageId: message.id, startPinged: Boolean(content) },
    });
    await ensureCollaborationForRaffle(raffleId).catch((error) =>
      logger.warn(
        { error, raffleId },
        "published raffle Collab Hub auto-link failed",
      ),
    );
    return { ok: true };
  } catch (err) {
    const e = err as {
      code?: number;
      message?: string;
      rawError?: { message?: string };
    };
    // Discord's top-level message includes the exact invalid field; rawError's
    // message is often only the unhelpful "Invalid Form Body" summary.
    const detail = e.message ?? e.rawError?.message ?? "unknown error";
    logger.warn(
      { err, raffleId, channelId: raffle.channelId },
      "failed to post raffle embed",
    );
    return {
      ok: false,
      reason: `Discord rejected the post in <#${channel.id}> — ${detail}${e.code ? ` (code ${e.code})` : ""}. Give me **View Channel**, **Send Messages** and **Embed Links** in that channel.`,
    };
  }
}

/** Re-render the live raffle embed (countdown, entry count, status). */
export async function refreshRaffleMessage(
  client: Client,
  raffleId: number,
): Promise<void> {
  const raffle = await getRaffle(raffleId);
  if (!raffle || !raffle.channelId || !raffle.messageId) return;

  const channel = await fetchTextChannel(client, raffle.channelId);
  if (!channel) return;

  const message = await channel.messages
    .fetch(raffle.messageId)
    .catch(() => null);
  if (!message) return;

  const content = startMentionContent(raffle);
  await message
    .edit({
      content: content || null,
      embeds: [buildRaffleEmbed(raffle)],
      components: buildRaffleComponents(raffle),
      allowedMentions: { parse: content ? ["everyone"] : [] },
    })
    .catch((err) => logger.warn({ err, raffleId }, "refresh edit failed"));
}

/**
 * Delete the old raffle post and publish a fresh one. Used when a scheduled
 * raffle flips from UPCOMING to LIVE: re-posting (a message *create*) is what
 * fires the @everyone push notification and puts the ping in the original post,
 * whereas an in-place edit would neither notify nor look un-edited.
 */
export async function repostRaffleMessage(
  client: Client,
  raffleId: number,
): Promise<PublishResult> {
  const raffle = await getRaffle(raffleId);
  if (!raffle) return { ok: false, reason: "raffle not found" };

  if (raffle.channelId && raffle.messageId) {
    const channel = await fetchTextChannel(client, raffle.channelId);
    const old = channel
      ? await channel.messages.fetch(raffle.messageId).catch(() => null)
      : null;
    if (old) await old.delete().catch(() => undefined);
  }

  return publishRaffleMessage(client, raffleId);
}

/**
 * The mention text shown ABOVE the raffle embed (in the message content) while
 * it's live — so the @everyone/@here ping is part of the raffle post itself,
 * not a separate message. Empty unless the raffle is live and pings are on.
 * Note: Discord only push-notifies on message *create*, so an instant ("now")
 * raffle pings on post; a scheduled one is re-posted when it flips live.
 */
function startMentionContent(raffle: {
  status: RaffleStatus;
  startPing: string;
}): string {
  if (raffle.status !== RaffleStatus.LIVE || raffle.startPing === "none")
    return "";
  return raffle.startPing === "here" ? "@here" : "@everyone";
}

export async function editRaffle(
  raffleId: number,
  actorId: string,
  data: Prisma.RaffleUpdateInput,
): Promise<RaffleWithRoles | null> {
  const raffle = await prisma.raffle.update({
    where: { id: raffleId },
    data,
    include: raffleInclude,
  });
  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.RAFFLE,
    action: "RAFFLE_EDIT",
    message: `Edited raffle #${raffleId}`,
    actorId,
    metadata: { fields: Object.keys(data) },
  });
  return raffle;
}

export async function deleteRaffle(
  raffleId: number,
  actorId: string,
  client?: Client,
): Promise<boolean> {
  const raffle = await getRaffle(raffleId);
  if (!raffle) return false;
  const proof = await prisma.proof.findUnique({
    where: { raffleId },
    select: { pdfPath: true, csvPath: true, cardPath: true },
  });

  // Best-effort cleanup of the live message.
  if (client && raffle.channelId && raffle.messageId) {
    const channel = await fetchTextChannel(client, raffle.channelId);
    await channel?.messages
      .fetch(raffle.messageId)
      .then((m) => m.delete())
      .catch(() => undefined);
  }

  // Write the guild audit before deletion. The raffle FK is set to null by the
  // delete, preserving the event without referencing a removed record.
  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.RAFFLE,
    action: "RAFFLE_DELETE",
    message: `Deleted raffle #${raffleId} "${raffle.title}"`,
    actorId,
  });
  await prisma.raffle.delete({ where: { id: raffleId } });

  const proofPaths = [proof?.pdfPath, proof?.csvPath, proof?.cardPath].filter(
    (value): value is string => Boolean(value),
  );
  await Promise.all(
    proofPaths.map((file) =>
      fs.rm(file, { force: true }).catch(() => undefined),
    ),
  );
  if (proofPaths[0]) {
    await fs.rmdir(path.dirname(proofPaths[0])).catch(() => undefined);
  }
  return true;
}

export async function listRaffles(
  guildId: string,
  status?: RaffleStatus,
): Promise<RaffleWithRoles[]> {
  return prisma.raffle.findMany({
    where: { guildId, ...(status ? { status } : {}) },
    include: raffleInclude,
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}

export interface RaffleStats {
  totalRaffles: number;
  liveRaffles: number;
  totalEntries: number;
  totalWinners: number;
  uniqueParticipants: number;
}

export async function getGuildStats(guildId: string): Promise<RaffleStats> {
  const raffleIds = (
    await prisma.raffle.findMany({ where: { guildId }, select: { id: true } })
  ).map((r) => r.id);

  const [totalRaffles, liveRaffles, totalWinners, participants] =
    await Promise.all([
      prisma.raffle.count({ where: { guildId } }),
      prisma.raffle.count({ where: { guildId, status: RaffleStatus.LIVE } }),
      prisma.winner.count({
        where: { raffleId: { in: raffleIds }, replaced: false },
      }),
      prisma.participant.findMany({
        where: { raffleId: { in: raffleIds } },
        select: { userId: true },
      }),
    ]);

  return {
    totalRaffles,
    liveRaffles,
    totalEntries: participants.length,
    totalWinners,
    uniqueParticipants: new Set(participants.map((p) => p.userId)).size,
  };
}

/**
 * Fetch any guild channel the bot can send messages in — text, announcement,
 * voice/stage text chat, and threads. Returns null for DMs / non-text / unknown.
 */
export async function fetchTextChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  if (channel.isTextBased() && !channel.isDMBased()) {
    return channel as GuildTextBasedChannel;
  }
  return null;
}

/**
 * Check whether the bot can actually post a raffle embed in a channel.
 * Returns the list of missing permission names (empty = all good, or unknown).
 */
export function missingPostPermissions(
  channel: GuildTextBasedChannel,
  me: import("discord.js").GuildMember | null,
): string[] {
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms) return [];
  const required: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  // Threads need SendMessagesInThreads instead of SendMessages.
  if (channel.isThread()) {
    required[1] = [
      PermissionFlagsBits.SendMessagesInThreads,
      "Send Messages in Threads",
    ];
  }
  return required.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
}
