import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAID_CREATE,
    );
    const source = await prisma.raid.findFirst({
      where: { id: params.id, organizationId: org.id },
    });
    if (!source)
      return NextResponse.json({ error: "Raid not found." }, { status: 404 });
    const duration = Math.max(
      15 * 60_000,
      source.endAt.getTime() - source.startAt.getTime(),
    );
    const startAt = new Date(Date.now() + 60 * 60_000);
    const duplicate = await prisma.raid.create({
      data: {
        organizationId: source.organizationId,
        guildId: source.guildId,
        title: `Copy of ${source.title}`.slice(0, 120),
        tweetUrls: source.tweetUrls,
        instructions: source.instructions,
        proofType: source.proofType,
        startPing: source.startPing,
        startAt,
        endAt: new Date(startAt.getTime() + duration),
        channelId: source.channelId,
        staffChannelId: source.staffChannelId,
        rewardRoleId: source.rewardRoleId,
        rewardRoleName: source.rewardRoleName,
        participantLimit: source.participantLimit,
        allowMultipleSubmissions: source.allowMultipleSubmissions,
        announcementMessage: source.announcementMessage,
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "RAID_DUPLICATE", {
      targetType: "raid",
      targetId: duplicate.id,
      metadata: { sourceRaidId: source.id },
    });
    return NextResponse.json({ ok: true, id: duplicate.id });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid duplicate failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
