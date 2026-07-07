import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { taskActionUrl, type TaskConfig } from "@/lib/verify";
import {
  getLegacyRaffleTasks,
  LEGACY_TASK_CLICK,
  LEGACY_TASK_VERIFY,
  parseLegacyTaskId,
  TASK_DEFINITION_CLICK,
} from "@/lib/legacy-raffle-tasks";
import { LogCategory } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record that a member opened a legacy raffle-link task before attesting. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const parsed = parseLegacyTaskId(params.id);
    if (!parsed) return recordTaskDefinitionClick(params.id, user.id, user.username);

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

async function recordTaskDefinitionClick(taskId: string, userId: string, username: string) {
  const task = await prisma.taskDefinition.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      type: true,
      config: true,
      active: true,
      organization: {
        select: {
          guildConnections: { select: { guildId: true }, take: 1 },
        },
      },
    },
  });
  if (!task || !task.active) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const cfg = (task.config ?? {}) as TaskConfig;
  const actionUrl = taskActionUrl(task.type, cfg);
  if (!actionUrl) {
    return NextResponse.json({ error: "This task has no link to open." }, { status: 400 });
  }

  const guildId =
    typeof cfg.guildId === "string" && cfg.guildId
      ? cfg.guildId
      : task.organization.guildConnections[0]?.guildId;
  if (!guildId) {
    return NextResponse.json(
      { error: "This task is missing its community server." },
      { status: 400 },
    );
  }

  const verified = await prisma.taskCompletion.findUnique({
    where: { taskId_userId: { taskId, userId } },
    select: { status: true },
  });
  if (verified?.status === "VERIFIED") {
    return NextResponse.json({ status: "VERIFIED" });
  }

  const existing = await prisma.log.findFirst({
    where: {
      guildId,
      actorId: userId,
      action: TASK_DEFINITION_CLICK,
      metadata: { path: ["taskId"], equals: taskId },
    },
    select: { id: true },
  });
  if (!existing) {
    await prisma.log.create({
      data: {
        guildId,
        actorId: userId,
        category: LogCategory.ENTRY,
        action: TASK_DEFINITION_CLICK,
        message: `${username} opened "${task.title}"`,
        metadata: {
          taskId: task.id,
          title: task.title,
          type: task.type,
          url: actionUrl,
          method: "link_open",
        },
      },
    });
  }

  return NextResponse.json({ status: "CLICKED" });
}
