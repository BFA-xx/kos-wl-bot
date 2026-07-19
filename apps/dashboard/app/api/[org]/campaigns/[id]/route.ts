import { NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
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
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.CAMPAIGN_EDIT,
    );
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, organizationId: org.id },
      include: { _count: { select: { tasks: true, raffles: true } } },
    });
    if (!campaign)
      return NextResponse.json(
        { error: "Campaign not found." },
        { status: 404 },
      );
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : null;

    if (action) {
      const status = statusForAction(action, campaign.startAt);
      if (!status)
        return NextResponse.json(
          { error: "Unsupported campaign action." },
          { status: 400 },
        );
      if (!canApplyAction(action, campaign.status))
        return NextResponse.json(
          {
            error: `Campaign cannot ${action} from ${campaign.status.toLowerCase()}.`,
          },
          { status: 409 },
        );
      if (
        action === "publish" &&
        campaign._count.tasks + campaign._count.raffles === 0
      )
        return NextResponse.json(
          { error: "Add at least one campaign step before publishing." },
          { status: 409 },
        );
      if (
        action === "publish" &&
        campaign.endAt &&
        campaign.endAt <= new Date()
      )
        return NextResponse.json(
          { error: "Move the campaign end into the future before publishing." },
          { status: 409 },
        );
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status },
      });
      await logAudit(org.id, user.id, `CAMPAIGN_${action.toUpperCase()}`, {
        targetType: "campaign",
        targetId: campaign.id,
        metadata: { from: campaign.status, to: status },
      });
      return NextResponse.json({ ok: true, status });
    }

    if (
      campaign.status === CampaignStatus.ENDED ||
      campaign.status === CampaignStatus.CANCELLED
    )
      return NextResponse.json(
        { error: "Ended or cancelled campaigns are read-only." },
        { status: 409 },
      );

    const title =
      typeof body.title === "string" ? body.title.trim() : campaign.title;
    const description =
      "description" in body
        ? String(body.description ?? "").trim() || null
        : campaign.description;
    const startAt =
      "startAt" in body ? parseOptionalDate(body.startAt) : campaign.startAt;
    const endAt =
      "endAt" in body ? parseOptionalDate(body.endAt) : campaign.endAt;
    const completionPoints =
      "completionPoints" in body
        ? Number(body.completionPoints)
        : campaign.completionPoints;
    if (!title || title.length > 120)
      return NextResponse.json(
        { error: "Campaign title is required." },
        { status: 400 },
      );
    if (description && description.length > 1000)
      return NextResponse.json(
        { error: "Description is too long." },
        { status: 400 },
      );
    if (startAt === undefined || endAt === undefined)
      return NextResponse.json(
        { error: "Campaign dates are invalid." },
        { status: 400 },
      );
    if (startAt && endAt && endAt <= startAt)
      return NextResponse.json(
        { error: "Campaign end must be after its start." },
        { status: 400 },
      );
    if (
      !Number.isInteger(completionPoints) ||
      completionPoints < 0 ||
      completionPoints > 1_000_000
    )
      return NextResponse.json(
        { error: "Completion points must be between 0 and 1,000,000." },
        { status: 400 },
      );

    const taskIds = "taskIds" in body ? uniqueStrings(body.taskIds) : null;
    const raffleIds =
      "raffleIds" in body ? uniquePositiveInts(body.raffleIds) : null;
    if (taskIds || raffleIds) {
      const nextTaskIds =
        taskIds ??
        (
          await prisma.campaignTask.findMany({
            where: { campaignId: campaign.id },
            select: { taskId: true },
          })
        ).map((row) => row.taskId);
      const nextRaffleIds =
        raffleIds ??
        (
          await prisma.campaignRaffle.findMany({
            where: { campaignId: campaign.id },
            select: { raffleId: true },
          })
        ).map((row) => row.raffleId);
      if (nextTaskIds.length + nextRaffleIds.length === 0)
        return NextResponse.json(
          { error: "Add at least one task or raffle step." },
          { status: 400 },
        );
      const [taskCount, raffleCount] = await Promise.all([
        nextTaskIds.length
          ? prisma.taskDefinition.count({
              where: { id: { in: nextTaskIds }, organizationId: org.id },
            })
          : 0,
        nextRaffleIds.length
          ? prisma.raffle.count({
              where: { id: { in: nextRaffleIds }, guildId: { in: guildIds } },
            })
          : 0,
      ]);
      if (
        taskCount !== nextTaskIds.length ||
        raffleCount !== nextRaffleIds.length
      )
        return NextResponse.json(
          {
            error: "One or more selected steps are outside this organization.",
          },
          { status: 400 },
        );
      await prisma.$transaction(async (tx) => {
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { title, description, startAt, endAt, completionPoints },
        });
        await tx.campaignTask.deleteMany({
          where: { campaignId: campaign.id },
        });
        await tx.campaignRaffle.deleteMany({
          where: { campaignId: campaign.id },
        });
        if (nextTaskIds.length)
          await tx.campaignTask.createMany({
            data: nextTaskIds.map((taskId, position) => ({
              campaignId: campaign.id,
              taskId,
              required: true,
              position,
            })),
          });
        if (nextRaffleIds.length)
          await tx.campaignRaffle.createMany({
            data: nextRaffleIds.map((raffleId, index) => ({
              campaignId: campaign.id,
              raffleId,
              required: true,
              position: nextTaskIds.length + index,
            })),
          });
      });
    } else {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { title, description, startAt, endAt, completionPoints },
      });
    }
    await logAudit(org.id, user.id, "CAMPAIGN_UPDATE", {
      targetType: "campaign",
      targetId: campaign.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("campaign update failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.CAMPAIGN_EDIT,
    );
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, organizationId: org.id },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!campaign)
      return NextResponse.json(
        { error: "Campaign not found." },
        { status: 404 },
      );
    if (
      (campaign.status !== CampaignStatus.DRAFT &&
        campaign.status !== CampaignStatus.CANCELLED) ||
      campaign._count.enrollments > 0
    )
      return NextResponse.json(
        { error: "Only empty draft or cancelled campaigns can be deleted." },
        { status: 409 },
      );
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await logAudit(org.id, user.id, "CAMPAIGN_DELETE", {
      targetType: "campaign",
      targetId: campaign.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function statusForAction(
  action: string,
  startAt: Date | null,
): CampaignStatus | null {
  if (action === "publish")
    return startAt && startAt > new Date()
      ? CampaignStatus.SCHEDULED
      : CampaignStatus.LIVE;
  if (action === "end") return CampaignStatus.ENDED;
  if (action === "cancel") return CampaignStatus.CANCELLED;
  return null;
}

function canApplyAction(action: string, status: CampaignStatus): boolean {
  if (action === "publish") return status === CampaignStatus.DRAFT;
  if (action === "end")
    return (
      status === CampaignStatus.SCHEDULED || status === CampaignStatus.LIVE
    );
  if (action === "cancel")
    return (
      status === CampaignStatus.DRAFT ||
      status === CampaignStatus.SCHEDULED ||
      status === CampaignStatus.LIVE
    );
  return false;
}

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

function uniquePositiveInts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(Number)
        .filter((item) => Number.isSafeInteger(item) && item > 0),
    ),
  ];
}
