import { NextResponse } from "next/server";
import type { RewardRedemptionStatus } from "@prisma/client";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { updateRedemptionStatus } from "@/lib/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(params.org, PERMISSIONS.SETTINGS_EDIT);
    const body = await req.json();
    const status = String(body.status ?? "") as RewardRedemptionStatus;
    if (!["FULFILLED", "CANCELLED", "REJECTED"].includes(status)) {
      return NextResponse.json({ error: "Invalid redemption status." }, { status: 400 });
    }
    const result = await updateRedemptionStatus({
      redemptionId: params.id,
      organizationId: org.id,
      actorId: user.id,
      status,
      note: String(body.note ?? "").trim(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    }
    await logAudit(org.id, user.id, "REWARD_REDEMPTION_UPDATE", {
      targetType: "RewardRedemption",
      targetId: params.id,
      metadata: { status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("redemption update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
