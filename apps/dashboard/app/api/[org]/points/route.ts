import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org } = await requireOrgAccess(params.org);
    const [aggregate, leaderboard, recent, guilds] = await Promise.all([
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
      prisma.guildConnection.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "asc" },
        include: {
          organization: { select: { id: true } },
        },
      }),
    ]);

    const guildRows = guilds.length
      ? await prisma.guild.findMany({
          where: { id: { in: guilds.map((g) => g.guildId) } },
          select: {
            id: true,
            name: true,
            defaultPointsChannelId: true,
          },
        })
      : [];

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
      guilds: guildRows.map((g) => ({
        id: g.id,
        name: g.name ?? g.id,
        pointsChannelId: g.defaultPointsChannelId,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("points api failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const body = await req.json();
    const guildId = String(body.guildId ?? "").trim();
    const channelId = String(body.pointsChannelId ?? "").trim();

    if (!guildIds.includes(guildId)) {
      return NextResponse.json({ error: "Unknown connected server." }, { status: 404 });
    }
    if (channelId && !/^\d{5,25}$/.test(channelId)) {
      return NextResponse.json({ error: "Pick a valid Discord channel." }, { status: 400 });
    }

    await prisma.guild.update({
      where: { id: guildId },
      data: { defaultPointsChannelId: channelId || null },
    });
    await logAudit(org.id, user.id, "POINTS_CHANNEL_UPDATE", {
      targetType: "Guild",
      targetId: guildId,
      metadata: { pointsChannelId: channelId || null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("points channel update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
