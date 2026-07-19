import { NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
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
    const { org, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.CAMPAIGN_VIEW,
    );
    const [campaigns, tasks, raffles] = await Promise.all([
      prisma.campaign.findMany({
        where: { organizationId: org.id },
        orderBy: [{ createdAt: "desc" }],
        include: {
          tasks: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: {
              task: { select: { id: true, title: true, active: true } },
            },
          },
          raffles: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: {
              raffle: {
                select: {
                  id: true,
                  projectName: true,
                  title: true,
                  status: true,
                },
              },
            },
          },
          _count: { select: { enrollments: true } },
          enrollments: {
            where: { status: "COMPLETED" },
            select: { id: true },
          },
        },
      }),
      prisma.taskDefinition.findMany({
        where: { organizationId: org.id },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          type: true,
          points: true,
          active: true,
        },
      }),
      guildIds.length
        ? prisma.raffle.findMany({
            where: {
              guildId: { in: guildIds },
              status: { notIn: ["DRAFT", "CANCELLED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              projectName: true,
              title: true,
              status: true,
              startAt: true,
              endAt: true,
            },
          })
        : [],
    ]);

    return NextResponse.json({
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        title: campaign.title,
        description: campaign.description,
        status: campaign.status,
        startAt: campaign.startAt,
        endAt: campaign.endAt,
        completionPoints: campaign.completionPoints,
        createdAt: campaign.createdAt,
        enrollmentCount: campaign._count.enrollments,
        completedCount: campaign.enrollments.length,
        tasks: campaign.tasks.map((link) => ({
          id: link.taskId,
          title: link.task.title,
          active: link.task.active,
          required: link.required,
        })),
        raffles: campaign.raffles.map((link) => ({
          id: link.raffleId,
          projectName: link.raffle.projectName,
          title: link.raffle.title,
          status: link.raffle.status,
          required: link.required,
        })),
      })),
      tasks,
      raffles,
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("campaign list failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.CAMPAIGN_CREATE,
    );
    const body = await req.json().catch(() => ({}));
    const parsed = await parseCampaignInput(body, org.id, guildIds);
    if ("error" in parsed)
      return NextResponse.json({ error: parsed.error }, { status: 400 });

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: org.id,
        title: parsed.title,
        description: parsed.description,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        completionPoints: parsed.completionPoints,
        status: body.publish
          ? parsed.startAt && parsed.startAt > new Date()
            ? CampaignStatus.SCHEDULED
            : CampaignStatus.LIVE
          : CampaignStatus.DRAFT,
        createdById: user.id,
        tasks: {
          create: parsed.taskIds.map((taskId, position) => ({
            taskId,
            required: true,
            position,
          })),
        },
        raffles: {
          create: parsed.raffleIds.map((raffleId, index) => ({
            raffleId,
            required: true,
            position: parsed.taskIds.length + index,
          })),
        },
      },
    });
    await logAudit(org.id, user.id, "CAMPAIGN_CREATE", {
      targetType: "campaign",
      targetId: campaign.id,
      metadata: {
        status: campaign.status,
        taskCount: parsed.taskIds.length,
        raffleCount: parsed.raffleIds.length,
      },
    });
    return NextResponse.json({ ok: true, id: campaign.id });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("campaign create failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function parseCampaignInput(
  body: Record<string, unknown>,
  organizationId: string,
  guildIds: string[],
): Promise<
  | {
      title: string;
      description: string | null;
      startAt: Date | null;
      endAt: Date | null;
      completionPoints: number;
      taskIds: string[];
      raffleIds: number[];
    }
  | { error: string }
> {
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const startAt = parseOptionalDate(body.startAt);
  const endAt = parseOptionalDate(body.endAt);
  const completionPoints = Number(body.completionPoints ?? 0);
  const taskIds = uniqueStrings(body.taskIds);
  const raffleIds = uniquePositiveInts(body.raffleIds);
  if (!title || title.length > 120)
    return { error: "Campaign title is required." };
  if (description.length > 1000) return { error: "Description is too long." };
  if (startAt === undefined || endAt === undefined)
    return { error: "Campaign dates are invalid." };
  if (startAt && endAt && endAt <= startAt)
    return { error: "Campaign end must be after its start." };
  if (
    !Number.isInteger(completionPoints) ||
    completionPoints < 0 ||
    completionPoints > 1_000_000
  )
    return { error: "Completion points must be between 0 and 1,000,000." };
  if (taskIds.length + raffleIds.length === 0)
    return { error: "Add at least one task or raffle step." };

  const [taskCount, raffleCount] = await Promise.all([
    taskIds.length
      ? prisma.taskDefinition.count({
          where: { id: { in: taskIds }, organizationId },
        })
      : 0,
    raffleIds.length
      ? prisma.raffle.count({
          where: { id: { in: raffleIds }, guildId: { in: guildIds } },
        })
      : 0,
  ]);
  if (taskCount !== taskIds.length)
    return { error: "One or more tasks do not belong to this organization." };
  if (raffleCount !== raffleIds.length)
    return { error: "One or more raffles do not belong to this organization." };
  return {
    title,
    description: description || null,
    startAt,
    endAt,
    completionPoints,
    taskIds,
    raffleIds,
  };
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
