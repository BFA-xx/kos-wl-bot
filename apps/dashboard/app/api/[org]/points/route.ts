import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org } = await requireOrgAccess(params.org);
    const [aggregate, leaderboard, recent] = await Promise.all([
      prisma.pointsLedger.aggregate({
        where: { organizationId: org.id },
        _sum: { delta: true },
        _count: true,
      }),
      prisma.pointsLedger.groupBy({
        by: ["userId"],
        where: { organizationId: org.id },
        _sum: { delta: true },
        _count: true,
        orderBy: { _sum: { delta: "desc" } },
        take: 50,
      }),
      prisma.pointsLedger.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              globalName: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    const users = leaderboard.length
      ? await prisma.user.findMany({
          where: { id: { in: leaderboard.map((row) => row.userId) } },
          select: {
            id: true,
            username: true,
            globalName: true,
            avatarUrl: true,
          },
        })
      : [];
    const byUser = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      totalPoints: aggregate._sum.delta ?? 0,
      eventCount: aggregate._count,
      leaderboard: leaderboard.map((row, index) => {
        const user = byUser.get(row.userId);
        return {
          rank: index + 1,
          userId: row.userId,
          name: user?.globalName ?? user?.username ?? row.userId,
          avatarUrl: user?.avatarUrl ?? null,
          points: row._sum.delta ?? 0,
          events: row._count,
        };
      }),
      recent: recent.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.user.globalName ?? row.user.username,
        avatarUrl: row.user.avatarUrl,
        delta: row.delta,
        reason: row.reason,
        createdAt: row.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("points api failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
