import { NextResponse } from "next/server";
import { syncCampaignProgress } from "@kos/db";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { notifyPointsChannel } from "@/lib/points";
import { fetchGuildMember } from "@/lib/raffle-entry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireUser();
    const now = new Date();
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: params.id,
        status: "LIVE",
        organization: { suspendedAt: null },
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        ],
      },
      select: {
        id: true,
        organization: {
          select: { guildConnections: { select: { guildId: true } } },
        },
      },
    });
    if (!campaign)
      return NextResponse.json(
        { error: "Campaign is not open." },
        { status: 409 },
      );
    const memberships = await Promise.all(
      campaign.organization.guildConnections.map((connection) =>
        fetchGuildMember(connection.guildId, user.id),
      ),
    );
    const isMember = memberships.some(
      (membership) =>
        membership !== "not_member" && membership !== "unavailable",
    );
    if (!isMember) {
      const unavailable = memberships.some(
        (membership) => membership === "unavailable",
      );
      return NextResponse.json(
        {
          error: unavailable
            ? "Could not confirm your Discord community membership. Try again shortly."
            : "Join this community's Discord server before joining its campaign.",
        },
        { status: unavailable ? 503 : 403 },
      );
    }
    await prisma.campaignEnrollment.upsert({
      where: {
        campaignId_userId: { campaignId: campaign.id, userId: user.id },
      },
      create: { campaignId: campaign.id, userId: user.id },
      update: {},
    });
    const result = await syncCampaignProgress(prisma, campaign.id, user.id);
    if (result?.awardedPoints) {
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
    console.error("campaign join failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
