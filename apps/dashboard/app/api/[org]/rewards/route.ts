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
    const [rewards, redemptions] = await Promise.all([
      prisma.reward.findMany({
        where: { organizationId: org.id },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        include: { _count: { select: { redemptions: true } } },
      }),
      prisma.rewardRedemption.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          reward: { select: { title: true } },
          user: { select: { id: true, username: true, globalName: true, avatarUrl: true } },
        },
      }),
    ]);

    return NextResponse.json({
      rewards: rewards.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        cost: r.cost,
        stock: r.stock,
        active: r.active,
        createdAt: r.createdAt,
        redemptionCount: r._count.redemptions,
      })),
      redemptions: redemptions.map((r) => ({
        id: r.id,
        rewardId: r.rewardId,
        rewardTitle: r.reward.title,
        userId: r.userId,
        userName: r.user.globalName ?? r.user.username,
        avatarUrl: r.user.avatarUrl,
        cost: r.cost,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt,
        fulfilledAt: r.fulfilledAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("rewards api failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const body = await req.json();
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const cost = Number(body.cost);
    const stockRaw = body.stock;
    const stock =
      stockRaw === "" || stockRaw === null || stockRaw === undefined
        ? null
        : Number(stockRaw);

    if (!title || title.length > 120) {
      return NextResponse.json({ error: "Reward title is required." }, { status: 400 });
    }
    if (!Number.isInteger(cost) || cost <= 0) {
      return NextResponse.json({ error: "Cost must be a positive number." }, { status: 400 });
    }
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      return NextResponse.json({ error: "Stock must be blank or zero/greater." }, { status: 400 });
    }

    const reward = await prisma.reward.create({
      data: {
        organizationId: org.id,
        title,
        description: description || null,
        cost,
        stock,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "REWARD_CREATE", {
      targetType: "Reward",
      targetId: reward.id,
      metadata: { title, cost, stock },
    });
    return NextResponse.json({ reward });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("reward create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
