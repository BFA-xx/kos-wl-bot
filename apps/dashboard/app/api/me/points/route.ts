import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const [balances, recent] = await Promise.all([
      prisma.pointsLedger.groupBy({
        by: ["organizationId"],
        where: { userId: user.id },
        _sum: { delta: true },
        _count: true,
        orderBy: { _sum: { delta: "desc" } },
      }),
      prisma.pointsLedger.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          organization: {
            select: { id: true, slug: true, name: true, logoUrl: true },
          },
        },
      }),
    ]);

    const orgs = balances.length
      ? await prisma.organization.findMany({
          where: { id: { in: balances.map((b) => b.organizationId) } },
          select: { id: true, slug: true, name: true, logoUrl: true },
        })
      : [];
    const byOrg = new Map(orgs.map((o) => [o.id, o]));

    return NextResponse.json({
      totalPoints: balances.reduce(
        (sum, row) => sum + (row._sum.delta ?? 0),
        0,
      ),
      balances: balances.map((row) => {
        const org = byOrg.get(row.organizationId);
        return {
          organizationId: row.organizationId,
          org: org
            ? { slug: org.slug, name: org.name, logoUrl: org.logoUrl }
            : { slug: "", name: "Unknown community", logoUrl: null },
          points: row._sum.delta ?? 0,
          events: row._count,
        };
      }),
      recent: recent.map((row) => ({
        id: row.id,
        delta: row.delta,
        reason: row.reason,
        createdAt: row.createdAt,
        org: {
          slug: row.organization.slug,
          name: row.organization.name,
          logoUrl: row.organization.logoUrl,
        },
      })),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("me points failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
