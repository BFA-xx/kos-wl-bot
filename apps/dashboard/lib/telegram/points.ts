import type { KosPointEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface KosPointsSummary {
  points: number;
  level: { level: number; name: string; minPoints: number } | null;
  nextLevel: { level: number; name: string; minPoints: number } | null;
}

interface KosLevelThreshold {
  level: number;
  name: string;
  minPoints: number;
}

export function resolveKosLevel(
  points: number,
  levels: KosLevelThreshold[],
): { level: KosLevelThreshold | null; nextLevel: KosLevelThreshold | null } {
  const ordered = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  return {
    level:
      [...ordered].reverse().find((item) => item.minPoints <= points) ?? null,
    nextLevel: ordered.find((item) => item.minPoints > points) ?? null,
  };
}

interface AwardInput {
  identityId: string;
  event: KosPointEvent;
  reason: string;
  source: string;
  referenceId: string;
  amount?: number;
}

export async function awardKosPoints(input: AwardInput): Promise<{
  awarded: boolean;
  amount: number;
}> {
  const configured =
    input.amount === undefined
      ? await prisma.kosRewardDefinition.findUnique({
          where: { event: input.event },
          select: { points: true, enabled: true },
        })
      : null;
  if (input.amount === undefined && (!configured || !configured.enabled)) {
    return { awarded: false, amount: 0 };
  }
  const amount = input.amount ?? configured?.points ?? 0;
  if (!Number.isSafeInteger(amount))
    throw new Error("Invalid KOS point amount");

  try {
    await prisma.kosPointTransaction.create({
      data: {
        identityId: input.identityId,
        event: input.event,
        amount,
        reason: input.reason.slice(0, 240),
        source: input.source.slice(0, 80),
        referenceId: input.referenceId.slice(0, 120),
      },
    });
    return { awarded: true, amount };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { awarded: false, amount };
    }
    throw error;
  }
}

export async function getKosPointsSummary(
  identityId: string,
): Promise<KosPointsSummary> {
  const [aggregate, levels] = await Promise.all([
    prisma.kosPointTransaction.aggregate({
      where: { identityId },
      _sum: { amount: true },
    }),
    prisma.kosLevel.findMany({ orderBy: { minPoints: "asc" } }),
  ]);
  const points = aggregate._sum.amount ?? 0;
  const { level, nextLevel } = resolveKosLevel(points, levels);
  return { points, level, nextLevel };
}

export type LeaderboardPeriod = "week" | "month" | "all";

export function kosLeaderboardStart(
  period: LeaderboardPeriod,
  now = new Date(),
): Date | undefined {
  if (period === "week") {
    const start = new Date(now);
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
  if (period === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return undefined;
}

export async function getKosLeaderboard(
  period: LeaderboardPeriod,
  requesterIdentityId: string,
): Promise<{
  leaders: Array<{ identityId: string; displayName: string; points: number }>;
  requesterRank: number | null;
  requesterPoints: number;
}> {
  const start = kosLeaderboardStart(period);
  const grouped = await prisma.kosPointTransaction.groupBy({
    by: ["identityId"],
    where: start ? { createdAt: { gte: start } } : undefined,
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });
  const positive = grouped
    .map((row) => ({
      identityId: row.identityId,
      points: row._sum.amount ?? 0,
    }))
    .filter((row) => row.points > 0);
  const identities = await prisma.kosIdentity.findMany({
    where: { id: { in: positive.slice(0, 10).map((row) => row.identityId) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(
    identities.map((identity) => [identity.id, identity.displayName]),
  );
  const requesterIndex = positive.findIndex(
    (row) => row.identityId === requesterIdentityId,
  );
  return {
    leaders: positive.slice(0, 10).map((row) => ({
      ...row,
      displayName: names.get(row.identityId) ?? "KOS member",
    })),
    requesterRank: requesterIndex < 0 ? null : requesterIndex + 1,
    requesterPoints: requesterIndex < 0 ? 0 : positive[requesterIndex].points,
  };
}
