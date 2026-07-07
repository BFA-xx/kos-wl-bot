import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const body = await req.json();
    const data: {
      title?: string;
      description?: string | null;
      cost?: number;
      stock?: number | null;
      active?: boolean;
    } = {};

    if ("title" in body) {
      const title = String(body.title ?? "").trim();
      if (!title || title.length > 120) {
        return NextResponse.json({ error: "Reward title is required." }, { status: 400 });
      }
      data.title = title;
    }
    if ("description" in body) {
      const description = String(body.description ?? "").trim();
      data.description = description || null;
    }
    if ("cost" in body) {
      const cost = Number(body.cost);
      if (!Number.isInteger(cost) || cost <= 0) {
        return NextResponse.json({ error: "Cost must be positive." }, { status: 400 });
      }
      data.cost = cost;
    }
    if ("stock" in body) {
      const raw = body.stock;
      const stock = raw === "" || raw === null || raw === undefined ? null : Number(raw);
      if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
        return NextResponse.json({ error: "Stock must be blank or zero/greater." }, { status: 400 });
      }
      data.stock = stock;
    }
    if ("active" in body) data.active = Boolean(body.active);

    const reward = await prisma.reward.updateMany({
      where: { id: params.id, organizationId: org.id },
      data,
    });
    if (reward.count === 0) {
      return NextResponse.json({ error: "Reward not found." }, { status: 404 });
    }
    await logAudit(org.id, user.id, "REWARD_UPDATE", {
      targetType: "Reward",
      targetId: params.id,
      metadata: data,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("reward update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const reward = await prisma.reward.updateMany({
      where: { id: params.id, organizationId: org.id },
      data: { active: false },
    });
    if (reward.count === 0) {
      return NextResponse.json({ error: "Reward not found." }, { status: 404 });
    }
    await logAudit(org.id, user.id, "REWARD_DISABLE", {
      targetType: "Reward",
      targetId: params.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("reward delete failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
