import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 86_400_000;

export async function GET(req: NextRequest, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.ANALYTICS_VIEW);
    const rScope = { guildId: { in: guildIds } };
    const pScope = { raffle: { guildId: { in: guildIds } } };

    const days = Number(req.nextUrl.searchParams.get("days")) || 30;
    const buckets = days <= 7 ? days : 12;
    const span = days * DAY;
    const now = Date.now();
    const start = now - span;
    const size = span / buckets;

    const [entryRows, raffleRows, topRaffles, totals] = await Promise.all([
      prisma.participant.findMany({
        where: { ...pScope, enteredAt: { gte: new Date(start) } },
        select: { enteredAt: true },
        take: 100000,
      }),
      prisma.raffle.findMany({
        where: { ...rScope, createdAt: { gte: new Date(start) } },
        select: { createdAt: true },
        take: 5000,
      }),
      prisma.raffle.findMany({
        where: rScope,
        orderBy: { entryCount: "desc" },
        take: 8,
        select: { id: true, projectName: true, title: true, entryCount: true, spots: true, status: true },
      }),
      prisma.raffle.aggregate({ where: rScope, _sum: { entryCount: true }, _count: true }),
    ]);

    const mkSeries = (rows: { getTime: () => number }[]) => {
      const s = Array.from({ length: buckets }, (_, i) => {
        const from = start + i * size;
        return {
          value: 0,
          label: new Date(from + size / 2).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
        };
      });
      for (const t of rows) {
        const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t.getTime() - start) / size)));
        if (s[idx]) s[idx]!.value++;
      }
      return s;
    };

    return NextResponse.json({
      entriesSeries: mkSeries(entryRows.map((r) => r.enteredAt)),
      rafflesSeries: mkSeries(raffleRows.map((r) => r.createdAt)),
      topRaffles,
      totalEntries: totals._sum.entryCount ?? 0,
      totalRaffles: totals._count,
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
