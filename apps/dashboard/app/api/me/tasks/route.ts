import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { TASK_TYPE_LABELS, taskActionUrl, type TaskConfig } from "@/lib/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tasks for the signed-in participant, scoped to one raffle (?raffle=N).
 * Participants aren't org members, so this is user-auth only — it exposes just
 * the task list of that raffle plus the caller's own completion status.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const raffleId = Number(req.nextUrl.searchParams.get("raffle"));
    if (!Number.isFinite(raffleId)) {
      return NextResponse.json({ error: "raffle query param required" }, { status: 400 });
    }

    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        projectName: true,
        title: true,
        status: true,
        RaffleTask: {
          include: { task: true },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!raffle) return NextResponse.json({ error: "Raffle not found." }, { status: 404 });

    const taskIds = raffle.RaffleTask.map((rt) => rt.taskId);
    const completions = taskIds.length
      ? await prisma.taskCompletion.findMany({
          where: { userId: user.id, taskId: { in: taskIds } },
        })
      : [];
    const byTask = new Map(completions.map((c) => [c.taskId, c]));

    const xLinked = Boolean(
      await prisma.connectedAccount.findUnique({
        where: { userId_provider: { userId: user.id, provider: "X" } },
        select: { id: true },
      }),
    );

    return NextResponse.json({
      raffle: {
        id: raffle.id,
        projectName: raffle.projectName,
        title: raffle.title,
        status: raffle.status,
      },
      xLinked,
      tasks: raffle.RaffleTask.map((rt) => {
        const c = byTask.get(rt.taskId);
        return {
          id: rt.task.id,
          type: rt.task.type,
          typeLabel: TASK_TYPE_LABELS[rt.task.type],
          title: rt.task.title,
          description: rt.task.description,
          required: rt.required,
          points: rt.task.points,
          active: rt.task.active,
          actionUrl: taskActionUrl(rt.task.type, (rt.task.config ?? {}) as TaskConfig),
          status: c?.status ?? "NOT_STARTED",
        };
      }),
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
