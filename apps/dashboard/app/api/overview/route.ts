import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sinceFor(range: string): Date | null {
  const now = Date.now();
  switch (range) {
    case "7d":
      return new Date(now - 7 * 86400000);
    case "1m":
      return new Date(now - 30 * 86400000);
    case "3m":
      return new Date(now - 90 * 86400000);
    case "all":
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "all";
  const since = sinceFor(range);
  const dateFilter = since ? { gte: since } : undefined;

  const [
    totalRaffles,
    liveRaffles,
    rangeRaffles,
    rangeEntries,
    rangeWinners,
    uniqueParticipants,
    live,
  ] = await Promise.all([
    prisma.raffle.count(),
    prisma.raffle.count({ where: { status: "LIVE" } }),
    prisma.raffle.count({ where: dateFilter ? { createdAt: dateFilter } : {} }),
    prisma.participant.count({ where: dateFilter ? { enteredAt: dateFilter } : {} }),
    prisma.winner.count({
      where: { replaced: false, ...(dateFilter ? { selectedAt: dateFilter } : {}) },
    }),
    prisma.participant
      .findMany({
        where: dateFilter ? { enteredAt: dateFilter } : {},
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((r) => r.length),
    prisma.raffle.findMany({
      where: { status: { in: ["LIVE", "UPCOMING"] } },
      orderBy: { endAt: "asc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    range,
    stats: {
      totalRaffles,
      liveRaffles,
      rangeRaffles,
      rangeEntries,
      rangeWinners,
      uniqueParticipants,
    },
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
