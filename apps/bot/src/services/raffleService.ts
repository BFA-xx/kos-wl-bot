import {
  type Client,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import {
  prisma,
  LogCategory,
  RaffleStatus,
  RoleMatchMode,
  WalletChain,
  Prisma,
} from "@kos/db";
import { buildRaffleEmbed, buildRaffleButtons } from "../embeds/raffleEmbed.js";
import { audit } from "./auditService.js";
import { ensureGuild } from "./userService.js";
import { logger } from "../logger.js";
import type { EntryRequirements } from "../types.js";

export interface CreateRaffleInput {
  guildId: string;
  createdById: string;
  projectName: string;
  title: string;
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
      projectName: input.projectName,
      title: input.title,
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
  const raffle = await getRaffle(raffleId);
  if (!raffle || !raffle.channelId) {
    return { ok: false, reason: "no target channel set" };
  }

  const channel = await fetchTextChannel(client, raffle.channelId);
  if (!channel) {
    logger.warn({ raffleId, channelId: raffle.channelId }, "raffle channel not found / not text");
    return { ok: false, reason: "I can't see that channel (or it isn't a text channel)." };
  }

  // Make sure the bot's member object is cached so the permission check is real.
  const me =
    channel.guild.members.me ?? (await channel.guild.members.fetchMe().catch(() => null));
  const missing = missingPostPermissions(channel, me);
  if (missing.length > 0) {
    return { ok: false, reason: `I'm missing **${missing.join(", ")}** in <#${channel.id}>.` };
  }

  try {
    const message = await channel.send({
      embeds: [buildRaffleEmbed(raffle)],
      components: [buildRaffleButtons(raffle.id, raffle.status)],
    });
    await prisma.raffle.update({
      where: { id: raffleId },
      data: { messageId: message.id },
    });
    return { ok: true };
  } catch (err) {
    const e = err as { code?: number; message?: string; rawError?: { message?: string } };
    const detail = e.rawError?.message ?? e.message ?? "unknown error";
    logger.warn({ err, raffleId, channelId: raffle.channelId }, "failed to post raffle embed");
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

  await message
    .edit({
      embeds: [buildRaffleEmbed(raffle)],
      components: [buildRaffleButtons(raffle.id, raffle.status)],
    })
    .catch((err) => logger.warn({ err, raffleId }, "refresh edit failed"));
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

  // Best-effort cleanup of the live message.
  if (client && raffle.channelId && raffle.messageId) {
    const channel = await fetchTextChannel(client, raffle.channelId);
    await channel?.messages
      .fetch(raffle.messageId)
      .then((m) => m.delete())
      .catch(() => undefined);
  }

  await prisma.raffle.delete({ where: { id: raffleId } });
  await audit({
    guildId: raffle.guildId,
    raffleId,
    category: LogCategory.RAFFLE,
    action: "RAFFLE_DELETE",
    message: `Deleted raffle #${raffleId} "${raffle.title}"`,
    actorId,
  });
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
      prisma.winner.count({ where: { raffleId: { in: raffleIds }, replaced: false } }),
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
    required[1] = [PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"];
  }
  return required.filter(([flag]) => !perms.has(flag)).map(([, name]) => name);
}
