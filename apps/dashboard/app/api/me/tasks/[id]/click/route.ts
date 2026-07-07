import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import {
  getLegacyRaffleTasks,
  LEGACY_TASK_CLICK,
  LEGACY_TASK_VERIFY,
  parseLegacyTaskId,
} from "@/lib/legacy-raffle-tasks";
import { LogCategory } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record that a member opened a legacy raffle-link task before attesting. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const parsed = parseLegacyTaskId(params.id);
    if (!parsed) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const raffle = await prisma.raffle.findUnique({
      where: { id: parsed.raffleId },
      select: { id: true, guildId: true, requirements: true },
    });
    if (!raffle) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const task = getLegacyRaffleTasks(raffle.id, raffle.requirements).find((t) => t.id === params.id);
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const verified = await prisma.log.findFirst({
      where: {
        raffleId: raffle.id,
        actorId: user.id,
        action: LEGACY_TASK_VERIFY,
        metadata: { path: ["taskKey"], equals: task.key },
      },
      select: { id: true },
    });
    if (verified) return NextResponse.json({ status: "VERIFIED" });

    await prisma.log.create({
      data: {
        guildId: raffle.guildId,
        raffleId: raffle.id,
        actorId: user.id,
        category: LogCategory.ENTRY,
        action: LEGACY_TASK_CLICK,
        message: `${user.username} opened "${task.label}" for raffle #${raffle.id}`,
        metadata: {
          taskId: task.id,
          taskKey: task.key,
          label: task.label,
          url: task.url,
          method: "link_open",
        },
      },
    });

    return NextResponse.json({ status: "CLICKED" });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("task click failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
