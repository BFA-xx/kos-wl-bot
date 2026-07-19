import { NextResponse } from "next/server";
import { syncCampaignProgress } from "@kos/db";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { notifyPointsChannel } from "@/lib/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const enrollment = await prisma.campaignEnrollment.findUnique({
      where: { campaignId_userId: { campaignId: params.id, userId: user.id } },
      select: { id: true },
    });
    if (!enrollment)
      return NextResponse.json(
        { error: "Join this campaign first." },
        { status: 409 },
      );
    const result = await syncCampaignProgress(prisma, params.id, user.id);
    if (!result)
      return NextResponse.json(
        { error: "Campaign not found." },
        { status: 404 },
      );
    if (result.awardedPoints) {
      await notifyPointsChannel({
        organizationId: result.organizationId,
        userId: user.id,
        delta: result.awardedPoints,
        reason: `completed campaign ${result.title}`,
      });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
