import { type GuildMember, type ChatInputCommandInteraction } from "discord.js";
import {
  prisma,
  Prisma,
  type TaskDefinition,
  type TaskType,
  type CompletionStatus,
  type RewardRedemptionStatus,
  syncCampaignsForTask,
} from "@kos/db";
import { KOS } from "../theme.js";
import { upsertUser } from "./userService.js";

export interface OrgForGuild {
  id: string;
  slug: string;
  name: string;
}

export interface TaskConfig {
  url?: string;
  xHandle?: string;
  tweetUrl?: string;
  guildId?: string;
  inviteUrl?: string;
  roleId?: string;
  roleName?: string;
  instructions?: string;
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  X_FOLLOW: "Follow on X",
  X_LIKE: "Like a post on X",
  X_REPOST: "Repost on X",
  X_COMMENT: "Comment on X",
  DISCORD_JOIN: "Join Discord",
  DISCORD_ROLE: "Hold Discord role",
  VISIT_LINK: "Visit link",
  MANUAL: "Manual review",
};

export async function orgForGuild(
  guildId: string,
): Promise<OrgForGuild | null> {
  const conn = await prisma.guildConnection.findUnique({
    where: { guildId },
    include: {
      organization: { select: { id: true, slug: true, name: true } },
    },
  });
  return conn?.organization ?? null;
}

export async function pointsBalance(
  organizationId: string,
  userId: string,
): Promise<number> {
  const agg = await prisma.pointsLedger.aggregate({
    where: { organizationId, userId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

export async function awardTaskPoints({
  organizationId,
  userId,
  taskId,
  taskTitle,
  points,
}: {
  organizationId: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  points: number;
}) {
  if (points > 0) {
    const row = await prisma.pointsLedger
      .create({
        data: {
          organizationId,
          userId,
          delta: points,
          reason: `Task: ${taskTitle}`,
          sourceType: "TASK",
          sourceId: taskId,
        },
      })
      .catch(() => undefined);
    if (row) {
      await notifyPointsChannel({
        organizationId,
        userId,
        delta: points,
        reason: `completed ${taskTitle}`,
      });
    }
  }
  const campaigns = await syncCampaignsForTask(prisma, taskId, userId);
  for (const campaign of campaigns) {
    if (!campaign.awardedPoints) continue;
    await notifyPointsChannel({
      organizationId: campaign.organizationId,
      userId,
      delta: campaign.awardedPoints,
      reason: `completed campaign ${campaign.title}`,
    });
  }
}

export function taskActionUrl(type: TaskType, cfg: TaskConfig): string | null {
  switch (type) {
    case "X_FOLLOW":
      return cfg.xHandle
        ? `https://x.com/${cfg.xHandle.replace(/^@/, "")}`
        : null;
    case "X_LIKE":
    case "X_REPOST":
    case "X_COMMENT":
      return cfg.tweetUrl ?? null;
    case "DISCORD_JOIN":
      return cfg.inviteUrl ?? null;
    case "VISIT_LINK":
      return cfg.url ?? null;
    default:
      return null;
  }
}

export async function verifyTaskForMember({
  task,
  member,
  evidenceNote,
}: {
  task: TaskDefinition;
  member: GuildMember;
  evidenceNote?: string | null;
}): Promise<{ status: CompletionStatus; reason: string; awarded?: number }> {
  await upsertUser({
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarUrl: member.user.displayAvatarURL(),
  });

  const existing = await prisma.taskCompletion.findUnique({
    where: { taskId_userId: { taskId: task.id, userId: member.id } },
    select: { status: true },
  });
  if (existing?.status === "VERIFIED") {
    await awardTaskPoints({
      organizationId: task.organizationId,
      userId: member.id,
      taskId: task.id,
      taskTitle: task.title,
      points: task.points,
    });
    return { status: "VERIFIED", reason: "Already verified.", awarded: 0 };
  }

  const result = await evaluateTask(task, member, evidenceNote);
  await prisma.taskCompletion.upsert({
    where: { taskId_userId: { taskId: task.id, userId: member.id } },
    create: {
      taskId: task.id,
      userId: member.id,
      status: result.status,
      verifiedAt: result.status === "VERIFIED" ? new Date() : null,
      evidence: result.evidence as Prisma.InputJsonValue | undefined,
    },
    update: {
      status: result.status,
      verifiedAt: result.status === "VERIFIED" ? new Date() : undefined,
      evidence: result.evidence as Prisma.InputJsonValue | undefined,
    },
  });

  if (result.status === "VERIFIED") {
    await awardTaskPoints({
      organizationId: task.organizationId,
      userId: member.id,
      taskId: task.id,
      taskTitle: task.title,
      points: task.points,
    });
    return {
      status: result.status,
      reason: result.reason,
      awarded: task.points,
    };
  }
  return { status: result.status, reason: result.reason };
}

async function evaluateTask(
  task: TaskDefinition,
  member: GuildMember,
  evidenceNote?: string | null,
): Promise<{
  status: CompletionStatus;
  reason: string;
  evidence?: Record<string, unknown>;
}> {
  const cfg = (task.config ?? {}) as TaskConfig;
  if (!task.active)
    return { status: "REJECTED", reason: "This task is disabled." };
  if (task.expiresAt && task.expiresAt < new Date()) {
    return { status: "REJECTED", reason: "This task has expired." };
  }

  if (task.type === "DISCORD_JOIN" || task.type === "DISCORD_ROLE") {
    if (cfg.guildId && cfg.guildId !== member.guild.id) {
      return {
        status: "PENDING",
        reason: `Use this command inside the required Discord server.`,
      };
    }
    if (
      task.type === "DISCORD_ROLE" &&
      cfg.roleId &&
      !member.roles.cache.has(cfg.roleId)
    ) {
      return {
        status: "PENDING",
        reason: `You do not have the ${cfg.roleName ?? "required"} role yet.`,
      };
    }
    return {
      status: "VERIFIED",
      reason: "Discord requirement verified.",
      evidence: {
        method: "discord_command_check",
        guildId: member.guild.id,
        roleId: task.type === "DISCORD_ROLE" ? cfg.roleId : undefined,
        at: new Date().toISOString(),
      },
    };
  }

  if (task.type === "VISIT_LINK") {
    return {
      status: "VERIFIED",
      reason: "Link visit attested.",
      evidence: {
        method: "discord_visit_attest",
        url: cfg.url ?? null,
        at: new Date().toISOString(),
      },
    };
  }

  if (task.type === "MANUAL") {
    return {
      status: "NEEDS_REVIEW",
      reason: "Submitted — the team will review it.",
      evidence: {
        method: "discord_manual_submit",
        note: evidenceNote ?? null,
        at: new Date().toISOString(),
      },
    };
  }

  const linked = await prisma.connectedAccount.findUnique({
    where: { userId_provider: { userId: member.id, provider: "X" } },
    select: { externalId: true, handle: true },
  });
  if (!linked) {
    return {
      status: "PENDING",
      reason: "Link your X account on the web profile first, then verify here.",
    };
  }
  return {
    status: "VERIFIED",
    reason: "X identity linked and action attested.",
    evidence: {
      method: "discord_x_link_attest",
      xUserId: linked.externalId,
      xHandle: linked.handle,
      target: cfg.xHandle ?? cfg.tweetUrl ?? null,
      type: task.type,
      at: new Date().toISOString(),
    },
  };
}

export async function redeemReward({
  rewardId,
  member,
}: {
  rewardId: string;
  member: GuildMember;
}): Promise<
  | {
      ok: true;
      redemptionId: string;
      title: string;
      cost: number;
      organizationId: string;
    }
  | { ok: false; error: string }
> {
  await upsertUser({
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarUrl: member.user.displayAvatarURL(),
  });

  const result = await prisma.$transaction(async (tx) => {
    const reward = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!reward || !reward.active)
      return { ok: false as const, error: "Reward is not available." };
    if (reward.stock !== null && reward.stock <= 0)
      return { ok: false as const, error: "Reward is out of stock." };

    const balance = await tx.pointsLedger.aggregate({
      where: { organizationId: reward.organizationId, userId: member.id },
      _sum: { delta: true },
    });
    const points = balance._sum.delta ?? 0;
    if (points < reward.cost) {
      return {
        ok: false as const,
        error: `You need ${reward.cost - points} more points.`,
      };
    }

    if (reward.stock !== null) {
      const claimed = await tx.reward.updateMany({
        where: { id: reward.id, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });
      if (claimed.count === 0)
        return { ok: false as const, error: "Reward is out of stock." };
    }

    const redemption = await tx.rewardRedemption.create({
      data: {
        organizationId: reward.organizationId,
        rewardId: reward.id,
        userId: member.id,
        cost: reward.cost,
      },
    });
    await tx.pointsLedger.create({
      data: {
        organizationId: reward.organizationId,
        userId: member.id,
        delta: -reward.cost,
        reason: `Reward redeemed: ${reward.title}`,
        sourceType: "REWARD_REDEEM",
        sourceId: redemption.id,
      },
    });

    return {
      ok: true as const,
      redemptionId: redemption.id,
      title: reward.title,
      cost: reward.cost,
      organizationId: reward.organizationId,
    };
  });

  if (result.ok) {
    await notifyPointsChannel({
      organizationId: result.organizationId,
      userId: member.id,
      delta: -result.cost,
      reason: `redeemed ${result.title}`,
    });
  }
  return result;
}

export async function updateRedemptionStatus({
  redemptionId,
  guildId,
  actorId,
  status,
}: {
  redemptionId: string;
  guildId: string;
  actorId: string;
  status: RewardRedemptionStatus;
}) {
  const org = await orgForGuild(guildId);
  if (!org)
    return {
      ok: false as const,
      error: "This server is not connected to an organization.",
    };

  return prisma.$transaction(async (tx) => {
    const redemption = await tx.rewardRedemption.findFirst({
      where: { id: redemptionId, organizationId: org.id },
      include: { reward: true },
    });
    if (!redemption)
      return { ok: false as const, error: "Redemption not found." };
    if (redemption.status !== "PENDING")
      return { ok: false as const, error: "Redemption is already closed." };

    if (status === "CANCELLED" || status === "REJECTED") {
      await tx.pointsLedger.create({
        data: {
          organizationId: org.id,
          userId: redemption.userId,
          delta: redemption.cost,
          reason: `Reward refunded: ${redemption.reward.title}`,
          sourceType: "REWARD_REFUND",
          sourceId: redemption.id,
        },
      });
      if (redemption.reward.stock !== null) {
        await tx.reward.update({
          where: { id: redemption.rewardId },
          data: { stock: { increment: 1 } },
        });
      }
    }

    await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status,
        fulfilledById: status === "FULFILLED" ? actorId : undefined,
        fulfilledAt: status === "FULFILLED" ? new Date() : undefined,
      },
    });
    return { ok: true as const };
  });
}

export async function notifyPointsChannel({
  organizationId,
  userId,
  delta,
  reason,
}: {
  organizationId: string;
  userId: string;
  delta: number;
  reason: string;
}) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, guildConnections: { select: { guildId: true } } },
  });
  if (!org) return;
  const guild = await prisma.guild.findFirst({
    where: {
      id: { in: org.guildConnections.map((g) => g.guildId) },
      defaultPointsChannelId: { not: null },
    },
    select: { defaultPointsChannelId: true },
  });
  const channelId = guild?.defaultPointsChannelId;
  if (!channelId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, globalName: true },
  });
  const sign = delta > 0 ? "+" : "";
  const display = user?.globalName ?? user?.username ?? userId;
  const channel = await globalThis.kosClient?.channels
    .fetch(channelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
  await channel
    .send({
      content: `<@${userId}> ${delta > 0 ? "earned" : "spent"} **${sign}${delta} points** — ${reason}.`,
      embeds: [
        {
          title: `${KOS.emoji.diamond} ${org.name} points update`,
          description: `**${display}** ${delta > 0 ? "earned" : "spent"} **${sign}${delta} points**.`,
          color: delta > 0 ? 0x10b981 : 0x8b5cf6,
          fields: [{ name: "Reason", value: reason.slice(0, 1024) }],
        },
      ],
      allowedMentions: { users: [userId] },
    })
    .catch(() => undefined);
}

declare global {
  // Set once in index.ts so service helpers can post best-effort point updates.
  // eslint-disable-next-line no-var
  var kosClient: import("discord.js").Client | undefined;
}
