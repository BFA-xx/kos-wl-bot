import { NextResponse } from "next/server";
import { RaidStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parseRaidInput } from "@/lib/raid-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAID_EDIT,
    );
    const raid = await prisma.raid.findFirst({
      where: { id: params.id, organizationId: org.id },
    });
    if (!raid)
      return NextResponse.json({ error: "Raid not found." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action ?? "");

    if (action === "publish") {
      if (raid.status !== RaidStatus.DRAFT)
        return NextResponse.json(
          { error: "Only a draft raid can be published." },
          { status: 409 },
        );
      if (raid.endAt <= new Date())
        return NextResponse.json(
          { error: "Update the raid end time before publishing." },
          { status: 400 },
        );
      await prisma.raid.update({
        where: { id: raid.id },
        data: {
          status: RaidStatus.SCHEDULED,
          failureReason: null,
          cancelledAt: null,
          finalizedAt: null,
        },
      });
      await auditAction(org.id, user.id, raid.id, "RAID_PUBLISH");
      return NextResponse.json({ ok: true });
    }

    if (action === "end") {
      if (raid.status !== RaidStatus.LIVE)
        return NextResponse.json(
          { error: "Only a live raid can be ended." },
          { status: 409 },
        );
      await prisma.raid.update({
        where: { id: raid.id },
        data: { endAt: new Date(), finalizedAt: null },
      });
      await auditAction(org.id, user.id, raid.id, "RAID_END_REQUEST");
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel") {
      if (
        raid.status === RaidStatus.ENDED ||
        raid.status === RaidStatus.CANCELLED
      )
        return NextResponse.json(
          { error: "This raid is already closed." },
          { status: 409 },
        );
      const now = new Date();
      await prisma.raid.update({
        where: { id: raid.id },
        data: {
          status: RaidStatus.CANCELLED,
          cancelledAt: now,
          finalizedAt:
            raid.status === RaidStatus.DRAFT || !raid.messageId ? now : null,
        },
      });
      await auditAction(org.id, user.id, raid.id, "RAID_CANCEL");
      return NextResponse.json({ ok: true });
    }

    if (
      raid.status === RaidStatus.ENDED ||
      raid.status === RaidStatus.CANCELLED
    )
      return NextResponse.json(
        { error: "Closed raids cannot be edited." },
        { status: 409 },
      );
    const input = parseRaidInput(body);
    if ("error" in input)
      return NextResponse.json({ error: input.error }, { status: 400 });
    if (!guildIds.includes(input.guildId))
      return NextResponse.json(
        { error: "That Discord server is not connected to this organization." },
        { status: 403 },
      );
    if (body.publish === true && input.endAt <= new Date())
      return NextResponse.json(
        { error: "A published raid must end in the future." },
        { status: 400 },
      );
    if (
      input.participantLimit !== null &&
      input.participantLimit < raid.validParticipantCount
    )
      return NextResponse.json(
        {
          error: `Participant limit cannot be lower than the ${raid.validParticipantCount} valid participants already accepted.`,
        },
        { status: 400 },
      );
    if (
      raid.status === RaidStatus.LIVE &&
      (input.guildId !== raid.guildId ||
        input.channelId !== raid.channelId ||
        input.startAt.getTime() !== raid.startAt.getTime() ||
        input.startPing !== raid.startPing ||
        input.rewardRoleId !== raid.rewardRoleId ||
        input.rewardRoleName !== raid.rewardRoleName)
    )
      return NextResponse.json(
        {
          error:
            "Server, raid channel, start time, start ping, and reward role cannot change after a raid starts.",
        },
        { status: 409 },
      );

    await prisma.raid.update({
      where: { id: raid.id },
      data: {
        ...input,
        ...(body.publish === true && raid.status === RaidStatus.DRAFT
          ? { status: RaidStatus.SCHEDULED }
          : {}),
        editRequestedAt: raid.messageId ? new Date() : null,
      },
    });
    await auditAction(org.id, user.id, raid.id, "RAID_EDIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("raid update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function auditAction(
  organizationId: string,
  actorId: string,
  raidId: string,
  action: string,
) {
  await logAudit(organizationId, actorId, action, {
    targetType: "raid",
    targetId: raidId,
  });
}
