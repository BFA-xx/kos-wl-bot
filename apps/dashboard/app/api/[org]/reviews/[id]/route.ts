import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { awardTaskPoints } from "@/lib/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Approve or reject a manual-review completion. */
export async function POST(
  req: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_CREATE,
    );
    const completion = await prisma.taskCompletion.findFirst({
      where: { id: params.id, task: { organizationId: org.id } },
      select: {
        id: true,
        userId: true,
        taskId: true,
        task: { select: { organizationId: true, title: true, points: true } },
      },
    });
    if (!completion)
      return NextResponse.json({ error: "Not found." }, { status: 404 });

    const b = await req.json().catch(() => ({}));
    const approve = b.decision === "approve";
    if (b.decision !== "approve" && b.decision !== "reject") {
      return NextResponse.json(
        { error: "decision must be approve|reject" },
        { status: 400 },
      );
    }

    await prisma.taskCompletion.update({
      where: { id: completion.id },
      data: {
        status: approve ? "VERIFIED" : "REJECTED",
        verifiedAt: approve ? new Date() : null,
        reviewedById: user.id,
      },
    });
    if (approve) {
      await awardTaskPoints({
        organizationId: completion.task.organizationId,
        userId: completion.userId,
        taskId: completion.taskId,
        taskTitle: completion.task.title,
        points: completion.task.points,
      });
    }
    await logAudit(
      org.id,
      user.id,
      approve ? "TASK_REVIEW_APPROVE" : "TASK_REVIEW_REJECT",
      {
        targetType: "completion",
        targetId: completion.id,
        metadata: { userId: completion.userId, taskId: completion.taskId },
      },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
