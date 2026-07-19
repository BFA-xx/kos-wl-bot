import { NextResponse } from "next/server";
import { campaignProgressSnapshot } from "@kos/db";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { taskActionUrl, type TaskConfig } from "@/lib/verify";
import { publicRafflePath } from "@/lib/raffle-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE", "ENDED"] },
        organization: { suspendedAt: null },
      },
      orderBy: [{ status: "asc" }, { endAt: "asc" }, { createdAt: "desc" }],
      take: 50,
      include: {
        organization: {
          select: { id: true, slug: true, name: true, logoUrl: true },
        },
        tasks: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          include: { task: true },
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
                endAt: true,
              },
            },
          },
        },
        enrollments: {
          where: { userId: user.id },
          select: { status: true, joinedAt: true, completedAt: true },
          take: 1,
        },
      },
    });

    const rows = await Promise.all(
      campaigns.map(async (campaign) => {
        const progress = await campaignProgressSnapshot(
          prisma,
          campaign.id,
          user.id,
        );
        const doneById = new Map(
          progress?.steps.map((step) => [step.id, step.done]) ?? [],
        );
        return {
          id: campaign.id,
          title: campaign.title,
          description: campaign.description,
          status: campaign.status,
          startAt: campaign.startAt,
          endAt: campaign.endAt,
          completionPoints: campaign.completionPoints,
          org: campaign.organization,
          enrollment: campaign.enrollments[0] ?? null,
          progress: progress
            ? {
                done: progress.done,
                total: progress.total,
                requiredDone: progress.requiredDone,
                requiredTotal: progress.requiredTotal,
                complete: progress.complete,
              }
            : null,
          steps: [
            ...campaign.tasks.map((link) => ({
              id: link.id,
              kind: "TASK" as const,
              sourceId: link.taskId,
              title: link.task.title,
              description: link.task.description,
              required: link.required,
              done: doneById.get(link.id) ?? false,
              active: link.task.active,
              points: link.task.points,
              actionUrl: taskActionUrl(
                link.task.type,
                (link.task.config ?? {}) as TaskConfig,
              ),
              rafflePath: null,
              position: link.position,
            })),
            ...campaign.raffles.map((link) => ({
              id: link.id,
              kind: "RAFFLE" as const,
              sourceId: String(link.raffleId),
              title: `${link.raffle.projectName} · ${link.raffle.title}`,
              description: `Enter this ${link.raffle.status.toLowerCase()} raffle`,
              required: link.required,
              done: doneById.get(link.id) ?? false,
              active: link.raffle.status === "LIVE",
              points: 0,
              actionUrl: null,
              rafflePath: publicRafflePath({
                raffleId: link.raffle.id,
                organizationSlug: campaign.organization.slug,
                projectName: link.raffle.projectName,
              }),
              position: link.position,
            })),
          ].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
        };
      }),
    );
    return NextResponse.json({ campaigns: rows });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("member campaigns failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
