import { createHash } from "node:crypto";
import {
  ChannelType,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
  type Client,
  type Guild,
  type Message,
  type Role,
} from "discord.js";
import {
  classifyRaidProof,
  LogCategory,
  prisma,
  RaidProofType,
  RaidStatus,
  RaidSubmissionStatus,
  type Prisma,
} from "@kos/db";
import { KOS } from "../theme.js";
import { logger } from "../logger.js";

const MAX_PROOF_IMAGES = 3;
const MAX_PROOF_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type RaidForEmbed = {
  title: string;
  tweetUrls: string[];
  instructions: string;
  endAt: Date;
  status: RaidStatus;
  rewardRoleId: string | null;
  rewardRoleName: string;
  participantLimit: number | null;
  allowMultipleSubmissions: boolean;
  validParticipantCount: number;
};

interface DurableAttachment {
  fileName: string;
  contentType: string;
  byteLength: number;
  data: Buffer;
}

class ParticipantLimitReached extends Error {}

/** Run all database-driven raid transitions for one scheduler tick. */
export async function processRaidLifecycle(
  client: Client,
  now: Date,
  batchSize: number,
): Promise<void> {
  await processRaidCancellations(client, batchSize);
  await processRaidEdits(client, batchSize);

  const due = await prisma.raid.findMany({
    where: { status: RaidStatus.SCHEDULED, startAt: { lte: now } },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  });
  for (const raid of due) {
    const claimed = await prisma.raid.updateMany({
      where: { id: raid.id, status: RaidStatus.SCHEDULED },
      data: { status: RaidStatus.LIVE, startedAt: now, failureReason: null },
    });
    if (claimed.count === 0) continue;
    await startRaid(client, raid.id).catch(async (err) => {
      const reason = errorMessage(err);
      logger.error({ err, raidId: raid.id }, "raid start failed");
      await prisma.raid
        .update({
          where: { id: raid.id },
          data: {
            status: RaidStatus.CANCELLED,
            cancelledAt: new Date(),
            failureReason: reason,
            finalizedAt: new Date(),
          },
        })
        .catch(() => undefined);
    });
  }

  const ending = await prisma.raid.findMany({
    where: { status: RaidStatus.LIVE, endAt: { lte: now } },
    orderBy: [{ endAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  });
  for (const raid of ending) {
    const claimed = await prisma.raid.updateMany({
      where: { id: raid.id, status: RaidStatus.LIVE },
      data: { status: RaidStatus.ENDED, endedAt: now, finalizedAt: null },
    });
    if (claimed.count === 0) continue;
    await finalizeRaid(client, raid.id).catch((err) =>
      logger.error({ err, raidId: raid.id }, "raid finalization failed"),
    );
  }

  const pendingFinalization = await prisma.raid.findMany({
    where: {
      status: RaidStatus.ENDED,
      finalizedAt: null,
    },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  });
  for (const raid of pendingFinalization) {
    await finalizeRaid(client, raid.id).catch((err) =>
      logger.error({ err, raidId: raid.id }, "raid reconciliation failed"),
    );
  }
}

/** Consume one ordinary Discord message as raid proof when it is in a live raid. */
export async function handleRaidSubmission(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;
  const raid = await prisma.raid.findFirst({
    where: {
      guildId: message.guildId,
      status: RaidStatus.LIVE,
      endAt: { gt: new Date() },
      OR: [
        { threadId: message.channelId },
        { threadId: null, channelId: message.channelId },
      ],
    },
    orderBy: { startedAt: "desc" },
  });
  if (!raid) return;
  if (
    await prisma.raidSubmission.findUnique({ where: { messageId: message.id } })
  )
    return;

  const durableAttachments = await downloadProofImages(message);
  const decision = classifyRaidProof({
    content: message.content,
    imageCount: durableAttachments.length,
    targetUrls: raid.tweetUrls,
    proofType: raid.proofType,
    instructions: raid.instructions,
  });
  const fingerprint = proofFingerprint(message.content, durableAttachments);

  await prisma.user.upsert({
    where: { id: message.author.id },
    create: {
      id: message.author.id,
      username: message.author.username,
      globalName: message.author.globalName,
      avatarUrl: message.author.displayAvatarURL({ size: 128 }),
    },
    update: {
      username: message.author.username,
      globalName: message.author.globalName,
      avatarUrl: message.author.displayAvatarURL({ size: 128 }),
    },
  });

  let recorded: { status: RaidSubmissionStatus; reason: string };
  try {
    recorded = await recordSubmission({
      raid,
      message,
      decision,
      fingerprint,
      durableAttachments,
    });
  } catch (err) {
    if (!(err instanceof ParticipantLimitReached)) throw err;
    recorded = await recordLimitReachedSubmission({
      raidId: raid.id,
      userId: message.author.id,
      message,
      decision,
      fingerprint,
    });
  }
  await acknowledgeSubmission(message, recorded.status, recorded.reason);
}

export function buildRaidEmbed(raid: RaidForEmbed): EmbedBuilder {
  const role = raid.rewardRoleId
    ? `<@&${raid.rewardRoleId}>`
    : `@${raid.rewardRoleName}`;
  const links = raid.tweetUrls
    .map(
      (url, index) =>
        `[Open X post${raid.tweetUrls.length > 1 ? ` ${index + 1}` : ""}](${url})`,
    )
    .join("\n");
  const submissionRule = raid.allowMultipleSubmissions
    ? "Post each proof in this thread. Exact duplicates are ignored."
    : "Post your proof once in this thread. One valid submission per member.";
  return new EmbedBuilder()
    .setColor(
      raid.status === RaidStatus.LIVE
        ? KOS.colors.live
        : raid.status === RaidStatus.ENDED
          ? KOS.colors.ended
          : KOS.colors.upcoming,
    )
    .setTitle(`⚡ ${raid.title}`)
    .setDescription(raid.instructions.slice(0, 4_000))
    .addFields(
      { name: "Raid post", value: links || "No post configured." },
      {
        name: raid.status === RaidStatus.ENDED ? "Ended" : "Ends",
        value: `<t:${Math.floor(raid.endAt.getTime() / 1000)}:F> · <t:${Math.floor(
          raid.endAt.getTime() / 1000,
        )}:R>`,
        inline: true,
      },
      { name: "Reward role", value: role, inline: true },
      {
        name: "Participants",
        value: raid.participantLimit
          ? `${raid.validParticipantCount} / ${raid.participantLimit}`
          : `${raid.validParticipantCount} valid`,
        inline: true,
      },
      { name: "Submit participation", value: submissionRule },
    )
    .setFooter({ text: KOS.footer })
    .setTimestamp();
}

async function startRaid(client: Client, raidId: string): Promise<void> {
  const raid = await prisma.raid.findUnique({
    where: { id: raidId },
    include: { guild: { select: { logChannelId: true } } },
  });
  if (!raid || raid.status !== RaidStatus.LIVE) return;
  const guild = await client.guilds.fetch(raid.guildId);
  const rewardRole = await resolveRewardRole(guild, raid);
  const channel = await guild.channels.fetch(raid.channelId);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("send" in channel)
  ) {
    throw new Error("The configured raid channel is unavailable.");
  }
  const post = await channel.send({
    content: raid.announcementMessage ?? undefined,
    embeds: [
      buildRaidEmbed({
        ...raid,
        rewardRoleId: rewardRole.id,
      }),
    ],
    allowedMentions: { parse: [] },
  });
  let threadId: string | null = null;
  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  ) {
    const thread = await post
      .startThread({
        name: `${raid.title} · proof`.slice(0, 100),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `KOS raid ${raid.id} proof collection`,
      })
      .catch((err) => {
        logger.warn(
          { err, raidId },
          "raid thread creation failed; using channel",
        );
        return null;
      });
    threadId = thread?.id ?? null;
    if (thread) {
      await thread.send({
        content:
          "Submit your comment link, quote link, repost link, or screenshot here. KOS will react when your proof is recorded.",
        allowedMentions: { parse: [] },
      });
    }
  }
  await prisma.raid.update({
    where: { id: raid.id },
    data: {
      messageId: post.id,
      threadId,
      rewardRoleId: rewardRole.id,
      failureReason: null,
    },
  });
  await writeRaidAudit(raid, "RAID_OPEN", `Raid ${raid.title} is live.`);
}

async function finalizeRaid(client: Client, raidId: string): Promise<void> {
  const raid = await prisma.raid.findUnique({
    where: { id: raidId },
    include: {
      guild: { select: { logChannelId: true } },
      participants: {
        where: { status: RaidSubmissionStatus.VALID },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!raid || raid.status !== RaidStatus.ENDED) return;
  const guild = await client.guilds.fetch(raid.guildId);
  const role = await resolveRewardRole(guild, raid);
  let assigned = 0;
  let failed = 0;
  for (const participant of raid.participants) {
    if (participant.roleAssignedAt) {
      assigned++;
      continue;
    }
    try {
      const member = await guild.members.fetch(participant.userId);
      await member.roles.add(
        role,
        `Valid KOS raid participation: ${raid.title}`,
      );
      await prisma.raidParticipant.update({
        where: { id: participant.id },
        data: {
          roleAssignedAt: new Date(),
          roleAssignmentError: null,
        },
      });
      assigned++;
    } catch (err) {
      const reason = errorMessage(err);
      await prisma.raidParticipant.update({
        where: { id: participant.id },
        data: { roleAssignmentError: reason.slice(0, 500) },
      });
      failed++;
    }
  }

  const [grouped, totalParticipants] = await Promise.all([
    prisma.raidSubmission.groupBy({
      by: ["status"],
      where: { raidId: raid.id },
      _count: { _all: true },
    }),
    prisma.raidParticipant.count({ where: { raidId: raid.id } }),
  ]);
  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  await updateRaidPost(client, {
    ...raid,
    rewardRoleId: role.id,
  });
  await closeRaidThread(client, raid.threadId);
  await upsertStaffSummary(client, raid, {
    total: totalParticipants,
    valid: raid.validParticipantCount,
    invalid: counts.get(RaidSubmissionStatus.INVALID) ?? 0,
    pending: counts.get(RaidSubmissionStatus.PENDING) ?? 0,
    duplicate: counts.get(RaidSubmissionStatus.DUPLICATE) ?? 0,
    assigned,
    failed,
  });
  await prisma.raid.update({
    where: { id: raid.id },
    data: {
      rewardRoleId: role.id,
      roleAssignmentCount: assigned,
      roleAssignmentFailedCount: failed,
      finalizedAt: new Date(),
      failureReason:
        failed > 0
          ? `${failed} valid participant${failed === 1 ? "" : "s"} could not receive the reward role.`
          : null,
    },
  });
  await writeRaidAudit(
    raid,
    "RAID_END",
    `Raid ${raid.title} ended with ${raid.validParticipantCount} valid participants.`,
  );
}

async function processRaidCancellations(
  client: Client,
  batchSize: number,
): Promise<void> {
  const cancelled = await prisma.raid.findMany({
    where: {
      status: RaidStatus.CANCELLED,
      finalizedAt: null,
      messageId: { not: null },
    },
    orderBy: [{ cancelledAt: "asc" }, { id: "asc" }],
    take: batchSize,
  });
  for (const raid of cancelled) {
    await updateRaidPost(client, raid, true).catch((err) =>
      logger.warn(
        { err, raidId: raid.id },
        "cancelled raid post update failed",
      ),
    );
    await closeRaidThread(client, raid.threadId);
    await prisma.raid.update({
      where: { id: raid.id },
      data: { finalizedAt: new Date() },
    });
  }
}

async function processRaidEdits(
  client: Client,
  batchSize: number,
): Promise<void> {
  const edits = await prisma.raid.findMany({
    where: { editRequestedAt: { not: null }, messageId: { not: null } },
    orderBy: [{ editRequestedAt: "asc" }, { id: "asc" }],
    take: batchSize,
  });
  for (const raid of edits) {
    await prisma.raid.update({
      where: { id: raid.id },
      data: { editRequestedAt: null },
    });
    await updateRaidPost(client, raid).catch((err) =>
      logger.warn({ err, raidId: raid.id }, "raid post refresh failed"),
    );
  }
}

async function updateRaidPost(
  client: Client,
  raid: RaidForEmbed & {
    id?: string;
    guildId?: string;
    channelId?: string;
    messageId?: string | null;
    announcementMessage?: string | null;
  },
  cancelled = false,
): Promise<void> {
  if (!raid.channelId || !raid.messageId) return;
  const channel = await client.channels.fetch(raid.channelId).catch(() => null);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("messages" in channel)
  )
    return;
  const message = await channel.messages
    .fetch(raid.messageId)
    .catch(() => null);
  if (!message) return;
  if (cancelled) {
    const embed = buildRaidEmbed({ ...raid, status: RaidStatus.ENDED })
      .setTitle(`✖ ${raid.title}`)
      .setDescription("This raid was cancelled. Submissions are closed.");
    await message.edit({
      content: raid.announcementMessage ?? undefined,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return;
  }
  await message.edit({
    content: raid.announcementMessage ?? undefined,
    embeds: [buildRaidEmbed(raid)],
    allowedMentions: { parse: [] },
  });
}

async function closeRaidThread(
  client: Client,
  threadId: string | null,
): Promise<void> {
  if (!threadId) return;
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread?.isThread()) return;
  await thread
    .setLocked(true, "KOS raid submissions closed")
    .catch(() => undefined);
  await thread.setArchived(true, "KOS raid ended").catch(() => undefined);
}

async function upsertStaffSummary(
  client: Client,
  raid: {
    id: string;
    guildId: string;
    title: string;
    channelId: string;
    staffChannelId: string | null;
    summaryChannelId: string | null;
    summaryMessageId: string | null;
    guild: { logChannelId: string | null };
  },
  counts: {
    total: number;
    valid: number;
    invalid: number;
    pending: number;
    duplicate: number;
    assigned: number;
    failed: number;
  },
): Promise<void> {
  const channelId =
    raid.summaryChannelId ??
    raid.staffChannelId ??
    raid.guild.logChannelId ??
    raid.channelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("send" in channel)
  )
    return;
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.success)
    .setTitle(`Raid summary · ${raid.title}`)
    .addFields(
      { name: "Total participants", value: String(counts.total), inline: true },
      { name: "Valid participants", value: String(counts.valid), inline: true },
      {
        name: "Invalid submissions",
        value: String(counts.invalid),
        inline: true,
      },
      { name: "Pending review", value: String(counts.pending), inline: true },
      { name: "Duplicates", value: String(counts.duplicate), inline: true },
      { name: "Roles assigned", value: String(counts.assigned), inline: true },
      {
        name: "Assignment failures",
        value: String(counts.failed),
        inline: true,
      },
    )
    .setFooter({ text: KOS.footer })
    .setTimestamp();
  let summary = null;
  if (
    raid.summaryMessageId &&
    raid.summaryChannelId === channelId &&
    "messages" in channel
  ) {
    summary = await channel.messages
      .fetch(raid.summaryMessageId)
      .catch(() => null);
    if (summary) await summary.edit({ embeds: [embed] });
  }
  if (!summary) {
    summary = await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }
  await prisma.raid.update({
    where: { id: raid.id },
    data: { summaryChannelId: channelId, summaryMessageId: summary.id },
  });
}

async function resolveRewardRole(
  guild: Guild,
  raid: {
    id: string;
    rewardRoleId: string | null;
    rewardRoleName: string;
    rewardRoleCreated: boolean;
  },
): Promise<Role> {
  const roles = await guild.roles.fetch();
  let role = raid.rewardRoleId ? (roles.get(raid.rewardRoleId) ?? null) : null;
  if (role && (role.id === guild.id || role.managed)) role = null;
  if (!role) {
    role =
      roles.find(
        (candidate) =>
          candidate.id !== guild.id &&
          !candidate.managed &&
          candidate.name.toLowerCase() === raid.rewardRoleName.toLowerCase(),
      ) ?? null;
  }
  let created = raid.rewardRoleCreated;
  if (!role) {
    role = await guild.roles.create({
      name: raid.rewardRoleName,
      mentionable: false,
      reason: `KOS raid reward: ${raid.id}`,
    });
    created = true;
  }
  if (!role.editable) {
    throw new Error(
      "The KOS bot role must be above the selected reward role.",
    );
  }
  await prisma.raid.update({
    where: { id: raid.id },
    data: {
      rewardRoleId: role.id,
      rewardRoleName: role.name,
      rewardRoleCreated: created,
    },
  });
  return role;
}

async function recordSubmission(input: {
  raid: {
    id: string;
    participantLimit: number | null;
    allowMultipleSubmissions: boolean;
  };
  message: Message<true>;
  decision: ReturnType<typeof classifyRaidProof>;
  fingerprint: string;
  durableAttachments: DurableAttachment[];
}): Promise<{ status: RaidSubmissionStatus; reason: string }> {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.raidParticipant.upsert({
      where: {
        raidId_userId: {
          raidId: input.raid.id,
          userId: input.message.author.id,
        },
      },
      create: {
        raidId: input.raid.id,
        userId: input.message.author.id,
      },
      update: {},
    });
    const exactDuplicate = await tx.raidSubmission.findFirst({
      where: {
        raidId: input.raid.id,
        userId: input.message.author.id,
        fingerprint: input.fingerprint,
        status: { not: RaidSubmissionStatus.INVALID },
      },
      select: { id: true },
    });
    let status = input.decision.status;
    let reason = input.decision.reason;
    if (exactDuplicate) {
      status = RaidSubmissionStatus.DUPLICATE;
      reason = "This exact proof was already submitted.";
    } else if (
      status === RaidSubmissionStatus.VALID &&
      participant.status === RaidSubmissionStatus.VALID &&
      !input.raid.allowMultipleSubmissions
    ) {
      status = RaidSubmissionStatus.DUPLICATE;
      reason = "You already have a valid submission for this raid.";
    }

    if (
      status === RaidSubmissionStatus.VALID &&
      participant.status !== RaidSubmissionStatus.VALID
    ) {
      const promoted = await tx.raidParticipant.updateMany({
        where: {
          id: participant.id,
          status: { not: RaidSubmissionStatus.VALID },
        },
        data: { status: RaidSubmissionStatus.VALID },
      });
      if (promoted.count > 0) {
        const claim = await tx.raid.updateMany({
          where: {
            id: input.raid.id,
            ...(input.raid.participantLimit
              ? {
                  validParticipantCount: {
                    lt: input.raid.participantLimit,
                  },
                }
              : {}),
          },
          data: { validParticipantCount: { increment: 1 } },
        });
        if (claim.count === 0) throw new ParticipantLimitReached();
      } else if (!input.raid.allowMultipleSubmissions) {
        status = RaidSubmissionStatus.DUPLICATE;
        reason = "You already have a valid submission for this raid.";
      }
    }

    const submission = await tx.raidSubmission.create({
      data: {
        raidId: input.raid.id,
        participantId: participant.id,
        userId: input.message.author.id,
        messageId: input.message.id,
        channelId: input.message.channelId,
        content: input.message.content.slice(0, 4_000) || null,
        status,
        proofKind: input.decision.kind,
        fingerprint: input.fingerprint,
        evidence: {
          reason,
          effectiveProofType: input.decision.effectiveProofType,
          xStatuses: input.decision.xStatuses.map((status) => ({
            url: status.url,
            handle: status.handle,
            statusId: status.statusId,
          })),
          verifier: "raid-proof-shape-v1",
        } as Prisma.InputJsonValue,
        attachments:
          status === RaidSubmissionStatus.DUPLICATE
            ? undefined
            : {
                create: input.durableAttachments.map((attachment) => ({
                  fileName: attachment.fileName,
                  contentType: attachment.contentType,
                  byteLength: attachment.byteLength,
                  data: attachment.data,
                })),
              },
      },
    });
    if (
      participant.status !== RaidSubmissionStatus.VALID &&
      status !== RaidSubmissionStatus.VALID &&
      status !== RaidSubmissionStatus.DUPLICATE
    ) {
      await recomputeParticipantStatus(tx, participant.id);
    }
    return { status: submission.status, reason };
  });
}

async function recordLimitReachedSubmission(input: {
  raidId: string;
  userId: string;
  message: Message<true>;
  decision: ReturnType<typeof classifyRaidProof>;
  fingerprint: string;
}): Promise<{ status: RaidSubmissionStatus; reason: string }> {
  const reason = "The raid participant limit has already been reached.";
  const submission = await prisma.$transaction(async (tx) => {
    const participant = await tx.raidParticipant.upsert({
      where: {
        raidId_userId: { raidId: input.raidId, userId: input.userId },
      },
      create: {
        raidId: input.raidId,
        userId: input.userId,
        status: RaidSubmissionStatus.INVALID,
      },
      update: {},
    });
    const created = await tx.raidSubmission.create({
      data: {
        raidId: input.raidId,
        participantId: participant.id,
        userId: input.userId,
        messageId: input.message.id,
        channelId: input.message.channelId,
        content: input.message.content.slice(0, 4_000) || null,
        status: RaidSubmissionStatus.INVALID,
        proofKind: input.decision.kind,
        fingerprint: input.fingerprint,
        evidence: {
          reason,
          effectiveProofType: input.decision.effectiveProofType,
          verifier: "raid-proof-shape-v1",
        },
      },
    });
    if (participant.status !== RaidSubmissionStatus.VALID) {
      await recomputeParticipantStatus(tx, participant.id);
    }
    return created;
  });
  return { status: submission.status, reason };
}

async function recomputeParticipantStatus(
  tx: Prisma.TransactionClient,
  participantId: string,
): Promise<void> {
  const rows = await tx.raidSubmission.findMany({
    where: {
      participantId,
      status: { not: RaidSubmissionStatus.DUPLICATE },
    },
    select: { status: true },
  });
  const status = rows.some((row) => row.status === RaidSubmissionStatus.VALID)
    ? RaidSubmissionStatus.VALID
    : rows.some((row) => row.status === RaidSubmissionStatus.PENDING)
      ? RaidSubmissionStatus.PENDING
      : RaidSubmissionStatus.INVALID;
  await tx.raidParticipant.update({
    where: { id: participantId },
    data: { status },
  });
}

async function downloadProofImages(
  message: Message<true>,
): Promise<DurableAttachment[]> {
  const candidates = [...message.attachments.values()]
    .filter((attachment) => {
      const type = attachment.contentType?.split(";", 1)[0]?.toLowerCase();
      return Boolean(type && ALLOWED_IMAGE_TYPES.has(type));
    })
    .slice(0, MAX_PROOF_IMAGES);
  const durable: DurableAttachment[] = [];
  for (const attachment of candidates) {
    try {
      if (attachment.size > MAX_PROOF_IMAGE_BYTES)
        throw new Error("Image exceeds the 5 MB proof limit.");
      const response = await fetch(attachment.url, {
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok)
        throw new Error(`Image download returned ${response.status}.`);
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType))
        throw new Error("Unsupported image type.");
      const data = await readBounded(response, MAX_PROOF_IMAGE_BYTES);
      durable.push({
        fileName: attachment.name.slice(0, 180) || "proof",
        contentType,
        byteLength: data.byteLength,
        data,
      });
    } catch (err) {
      logger.warn(
        { err, messageId: message.id, attachmentId: attachment.id },
        "raid proof image persistence failed",
      );
    }
  }
  return durable;
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("Image response was empty.");
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Image exceeds the proof limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Image response was empty.");
  return Buffer.concat(chunks, size);
}

function proofFingerprint(
  content: string,
  attachments: DurableAttachment[],
): string {
  const hash = createHash("sha256");
  hash.update(content.trim().toLowerCase());
  for (const attachment of attachments) {
    hash.update(attachment.contentType);
    hash.update(attachment.data);
  }
  return hash.digest("hex");
}

async function acknowledgeSubmission(
  message: Message<true>,
  status: RaidSubmissionStatus,
  reason: string,
): Promise<void> {
  const emoji =
    status === RaidSubmissionStatus.VALID
      ? "✅"
      : status === RaidSubmissionStatus.PENDING
        ? "⏳"
        : status === RaidSubmissionStatus.DUPLICATE
          ? "♻️"
          : "❌";
  await message.react(emoji).catch(() => undefined);
  if (
    status === RaidSubmissionStatus.PENDING ||
    status === RaidSubmissionStatus.INVALID
  ) {
    await message
      .reply({
        content:
          status === RaidSubmissionStatus.PENDING
            ? `Proof recorded for staff review: ${reason}`
            : `Proof was not accepted: ${reason}`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => undefined);
  }
}

async function writeRaidAudit(
  raid: { id: string; organizationId: string; guildId: string },
  action: string,
  message: string,
): Promise<void> {
  await Promise.all([
    prisma.auditLog
      .create({
        data: {
          organizationId: raid.organizationId,
          actorId: null,
          action,
          targetType: "raid",
          targetId: raid.id,
        },
      })
      .catch(() => undefined),
    prisma.log
      .create({
        data: {
          guildId: raid.guildId,
          category: LogCategory.SYSTEM,
          action,
          message,
          metadata: { raidId: raid.id },
        },
      })
      .catch(() => undefined),
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}
