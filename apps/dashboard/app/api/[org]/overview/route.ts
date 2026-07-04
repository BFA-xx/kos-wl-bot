import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 86_400_000;

function rangeMsFor(range: string): number | null {
  switch (range) {
    case "7d":
      return 7 * DAY;
    case "1m":
      return 30 * DAY;
    case "3m":
      return 90 * DAY;
    default:
      return null;
  }
}

function chartConfig(range: string): { span: number; buckets: number } {
  switch (range) {
    case "7d":
      return { span: 7 * DAY, buckets: 7 };
    case "1m":
      return { span: 30 * DAY, buckets: 6 };
    case "3m":
      return { span: 90 * DAY, buckets: 6 };
    default:
      return { span: 56 * DAY, buckets: 8 };
  }
}

function pct(cur: number, prev: number): number {
  if (prev <= 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

function label(date: Date, range: string): string {
  if (range === "7d") return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export async function GET(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org);
    // Scope fragments — the isolation boundary.
    const rScope = { guildId: { in: guildIds } };
    const pScope = { raffle: { guildId: { in: guildIds } } };

    const range = req.nextUrl.searchParams.get("range") ?? "7d";
    const now = Date.now();
    const rangeMs = rangeMsFor(range);
    const since = rangeMs ? new Date(now - rangeMs) : null;
    const prevSince = rangeMs ? new Date(now - 2 * rangeMs) : null;
    const between = (a: Date, b: Date) => ({ gte: a, lt: b });

    const [
      totalRaffles,
      liveRaffles,
      rangeRaffles,
      prevRaffles,
      rangeEntries,
      prevEntries,
      rangeWinners,
      prevWinners,
      uniqueRows,
      live,
      chartRows,
    ] = await Promise.all([
      prisma.raffle.count({ where: rScope }),
      prisma.raffle.count({ where: { ...rScope, status: "LIVE" } }),
      prisma.raffle.count({ where: { ...rScope, ...(since ? { createdAt: { gte: since } } : {}) } }),
      prisma.raffle.count({
        where: since && prevSince ? { ...rScope, createdAt: between(prevSince, since) } : { id: -1 },
      }),
      prisma.participant.count({ where: { ...pScope, ...(since ? { enteredAt: { gte: since } } : {}) } }),
      prisma.participant.count({
        where: since && prevSince ? { ...pScope, enteredAt: between(prevSince, since) } : { id: -1 },
      }),
      prisma.winner.count({ where: { ...pScope, replaced: false, ...(since ? { selectedAt: { gte: since } } : {}) } }),
      prisma.winner.count({
        where: since && prevSince ? { ...pScope, replaced: false, selectedAt: between(prevSince, since) } : { id: -1 },
      }),
      prisma.participant.findMany({
        where: { ...pScope, ...(since ? { enteredAt: { gte: since } } : {}) },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.raffle.findMany({
        where: { ...rScope, status: { in: ["LIVE", "UPCOMING"] } },
        orderBy: { endAt: "asc" },
        take: 8,
      }),
      (() => {
        const { span } = chartConfig(range);
        return prisma.participant.findMany({
          where: { ...pScope, enteredAt: { gte: new Date(now - span) } },
          select: { enteredAt: true },
          take: 50000,
        });
      })(),
    ]);

    const { span, buckets } = chartConfig(range);
    const start = now - span;
    const size = span / buckets;
    const series = Array.from({ length: buckets }, (_, i) => {
      const from = start + i * size;
      return { from, value: 0, label: label(new Date(from + size / 2), range) };
    });
    for (const row of chartRows) {
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((row.enteredAt.getTime() - start) / size)));
      if (series[idx]) series[idx]!.value++;
    }

    return NextResponse.json({
      range,
      stats: {
        totalRaffles,
        liveRaffles,
        rangeRaffles,
        rangeEntries,
        rangeWinners,
        uniqueParticipants: uniqueRows.length,
        trends: rangeMs
          ? {
              raffles: pct(rangeRaffles, prevRaffles),
              entries: pct(rangeEntries, prevEntries),
              winners: pct(rangeWinners, prevWinners),
            }
          : null,
      },
      series: series.map((s) => ({ label: s.label, value: s.value })),
      live: live.map((r) => ({
        id: r.id,
        projectName: r.projectName,
        title: r.title,
        status: r.status,
        spots: r.spots,
        entryCount: r.entryCount,
        endAt: r.endAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("overview failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
