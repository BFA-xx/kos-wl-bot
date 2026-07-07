import { prisma } from "@/lib/db";
import { Prisma, type RewardRedemptionStatus } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Award task points exactly once per user/task. No-op for zero-point tasks. */
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
  if (points <= 0) return;
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
    // Unique source = already awarded.
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

export async function pointsBalance(
  organizationId: string,
  userId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<number> {
  const agg = await tx.pointsLedger.aggregate({
    where: { organizationId, userId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

export async function redeemReward({
  rewardId,
  userId,
}: {
  rewardId: string;
  userId: string;
}): Promise<
  | { ok: true; redemptionId: string; cost: number; title: string; organizationId: string }
  | { ok: false; error: string; status?: number }
> {
  const result = await prisma.$transaction(async (tx) => {
    const reward = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!reward || !reward.active) {
      return { ok: false as const, error: "Reward is not available.", status: 404 };
    }
    if (reward.cost <= 0) {
      return { ok: false as const, error: "Reward is misconfigured.", status: 400 };
    }
    if (reward.stock !== null && reward.stock <= 0) {
      return { ok: false as const, error: "This reward is out of stock.", status: 409 };
    }

    const balance = await pointsBalance(reward.organizationId, userId, tx);
    if (balance < reward.cost) {
      return {
        ok: false as const,
        error: `You need ${reward.cost - balance} more points for this reward.`,
        status: 409,
      };
    }

    if (reward.stock !== null) {
      await tx.reward.update({
        where: { id: reward.id },
        data: { stock: { decrement: 1 } },
      });
    }

    const redemption = await tx.rewardRedemption.create({
      data: {
        organizationId: reward.organizationId,
        rewardId: reward.id,
        userId,
        cost: reward.cost,
      },
    });

    await tx.pointsLedger.create({
      data: {
        organizationId: reward.organizationId,
        userId,
        delta: -reward.cost,
        reason: `Reward redeemed: ${reward.title}`,
        sourceType: "REWARD_REDEEM",
        sourceId: redemption.id,
      },
    });

    return {
      ok: true as const,
      redemptionId: redemption.id,
      cost: reward.cost,
      title: reward.title,
      organizationId: reward.organizationId,
    };
  });

  if (result.ok) {
    await notifyPointsChannel({
      organizationId: result.organizationId,
      userId,
      delta: -result.cost,
      reason: `redeemed ${result.title}`,
    });
  }
  return result;
}

export async function updateRedemptionStatus({
  redemptionId,
  organizationId,
  actorId,
  status,
  note,
}: {
  redemptionId: string;
  organizationId: string;
  actorId: string;
  status: RewardRedemptionStatus;
  note?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const redemption = await tx.rewardRedemption.findFirst({
      where: { id: redemptionId, organizationId },
      include: { reward: true },
    });
    if (!redemption) return { ok: false as const, error: "Redemption not found.", status: 404 };
    if (redemption.status !== "PENDING") {
      return { ok: false as const, error: "Only pending redemptions can be updated.", status: 409 };
    }

    const refund = status === "CANCELLED" || status === "REJECTED";
    if (refund) {
      await tx.pointsLedger.create({
        data: {
          organizationId,
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

    const updated = await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status,
        note: note?.trim() || undefined,
        fulfilledById: status === "FULFILLED" ? actorId : undefined,
        fulfilledAt: status === "FULFILLED" ? new Date() : undefined,
      },
    });
    return { ok: true as const, redemption: updated };
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
  const token = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token || delta === 0) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      slug: true,
      guildConnections: { select: { guildId: true } },
    },
  });
  if (!org || org.guildConnections.length === 0) return;

  const guilds = await prisma.guild.findMany({
    where: {
      id: { in: org.guildConnections.map((g) => g.guildId) },
      defaultPointsChannelId: { not: null },
    },
    select: { defaultPointsChannelId: true },
    take: 1,
  });
  const channelId = guilds[0]?.defaultPointsChannelId;
  if (!channelId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, globalName: true },
  });
  const name = user?.globalName ?? user?.username ?? `<@${userId}>`;
  const sign = delta > 0 ? "+" : "";

  await fetch(`https://discord.com/api/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: `<@${userId}> ${delta > 0 ? "earned" : "spent"} **${sign}${delta} points** — ${reason}.`,
      embeds: [
        {
          title: `${org.name} points update`,
          description: `**${name}** ${delta > 0 ? "earned" : "spent"} **${sign}${delta} points**.`,
          color: delta > 0 ? 0x10b981 : 0x8b5cf6,
          fields: [{ name: "Reason", value: reason.slice(0, 1024) }],
          url: process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/${org.slug}/points`
            : undefined,
        },
      ],
      allowed_mentions: { users: [userId] },
    }),
  }).catch(() => undefined);
}
