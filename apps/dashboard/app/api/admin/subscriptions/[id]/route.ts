import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireSuperAdmin } from "@/lib/access";
import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLANS = ["FREE", "PRO", "SCALE"];
const STATUSES = ["ACTIVE", "PAST_DUE", "CANCELLED"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const data: { plan?: SubscriptionPlan; status?: SubscriptionStatus } = {};
    if (typeof body.plan === "string" && PLANS.includes(body.plan)) data.plan = body.plan as SubscriptionPlan;
    if (typeof body.status === "string" && STATUSES.includes(body.status)) data.status = body.status as SubscriptionStatus;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const updated = await prisma.subscription.update({ where: { id: params.id }, data });
    return NextResponse.json({ ok: true, plan: updated.plan, status: updated.status });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
