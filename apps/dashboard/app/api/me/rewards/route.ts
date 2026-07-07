import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const [rewards, balances, redemptions] = await Promise.all([
      prisma.reward.findMany({
        where: { active: true, organization: { suspendedAt: null } },
        orderBy: [{ cost: "asc" }, { createdAt: "desc" }],
        take: 100,
        include: {
          organization: { select: { id: true, slug: true, name: true, logoUrl: true } },
        },
      }),
      prisma.pointsLedger.groupBy({
        by: ["organizationId"],
        where: { userId: user.id },
        _sum: { delta: true },
      }),
      prisma.rewardRedemption.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          reward: { select: { title: true } },
          organization: { select: { slug: true, name: true, logoUrl: true } },
        },
      }),
    ]);
    const balanceByOrg = new Map(
      balances.map((b) => [b.organizationId, b._sum.delta ?? 0]),
    );

    return NextResponse.json({
      rewards: rewards.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        cost: r.cost,
        stock: r.stock,
        org: {
          id: r.organization.id,
          slug: r.organization.slug,
          name: r.organization.name,
          logoUrl: r.organization.logoUrl,
        },
        balance: balanceByOrg.get(r.organizationId) ?? 0,
      })),
      redemptions: redemptions.map((r) => ({
        id: r.id,
        rewardTitle: r.reward.title,
        org: {
          slug: r.organization.slug,
          name: r.organization.name,
          logoUrl: r.organization.logoUrl,
        },
        cost: r.cost,
        status: r.status,
        createdAt: r.createdAt,
        fulfilledAt: r.fulfilledAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("me rewards failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
