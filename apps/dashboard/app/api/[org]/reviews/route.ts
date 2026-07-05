import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Completions awaiting manual review across the org's tasks. */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { org } = await requireOrgAccess(params.org, PERMISSIONS.RAFFLE_CREATE);
    const rows = await prisma.taskCompletion.findMany({
      where: { status: "NEEDS_REVIEW", task: { organizationId: org.id } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        task: { select: { title: true, type: true } },
        user: { select: { username: true, globalName: true, avatarUrl: true } },
      },
    });
    return NextResponse.json({
      reviews: rows.map((r) => ({
        id: r.id,
        taskTitle: r.task.title,
        taskType: r.task.type,
        userId: r.userId,
        userName: r.user.globalName ?? r.user.username,
        avatarUrl: r.user.avatarUrl,
        submittedAt: r.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
