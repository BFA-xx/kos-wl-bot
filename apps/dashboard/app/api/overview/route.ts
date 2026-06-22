import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [totalRaffles, liveRaffles, totalWinners, entries, live] = await Promise.all([
    prisma.raffle.count(),
    prisma.raffle.count({ where: { status: "LIVE" } }),
    prisma.winner.count({ where: { replaced: false } }),
    prisma.participant.count(),
    prisma.raffle.findMany({
      where: { status: { in: ["LIVE", "UPCOMING"] } },
      orderBy: { endAt: "asc" },
      take: 10,
      include: { eligibleRoles: true, _count: { select: { participants: true } } },
    }),
  ]);

  return NextResponse.json({
    stats: { totalRaffles, liveRaffles, totalWinners, totalEntries: entries },
    live: live.map((r) => ({
      id: r.id,
      projectName: r.projectName,
      title: r.title,
      status: r.status,
      spots: r.spots,
      entryCount: r.entryCount,
      startAt: r.startAt,
      endAt: r.endAt,
    })),
  });
}
