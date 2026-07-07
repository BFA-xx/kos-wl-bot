import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { TASK_TYPE_LABELS, taskActionUrl, type TaskConfig } from "@/lib/verify";
import {
  getLegacyRaffleTasks,
  LEGACY_TASK_CLICK,
  LEGACY_TASK_VERIFY,
} from "@/lib/legacy-raffle-tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tasks for the signed-in participant.
 *
 * - Without a query param, this returns the profile Tasks hub: every live
 *   raffle from public KOS communities plus the caller's task completion state.
 * - With ?raffle=N, it returns the task list for one raffle.
 *
 * Participants aren't org members, so this is user-auth only — it exposes just
 * public raffle/task metadata plus the caller's own completion status.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const raffleParam = req.nextUrl.searchParams.get("raffle");

    if (!raffleParam) {
      const orgs = await prisma.organization.findMany({
        where: { suspendedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          guildConnections: { select: { guildId: true } },
        },
      });

      const orgByGuild = new Map<
        string,
        { id: string; slug: string; name: string; logoUrl: string | null }
      >();
      for (const org of orgs) {
        for (const g of org.guildConnections) {
          orgByGuild.set(g.guildId, {
            id: org.id,
            slug: org.slug,
            name: org.name,
            logoUrl: org.logoUrl,
          });
        }
      }

      const guildIds = [...orgByGuild.keys()];
      const raffles = guildIds.length
        ? await prisma.raffle.findMany({
            where: { guildId: { in: guildIds }, status: "LIVE" },
            orderBy: { endAt: "asc" },
            take: 50,
            select: {
              id: true,
              guildId: true,
              projectName: true,
              title: true,
              description: true,
              status: true,
              endAt: true,
              spots: true,
              entryCount: true,
              hideEntries: true,
              bannerUrl: true,
              requirements: true,
              participants: {
                where: { userId: user.id },
                select: { enteredAt: true },
                take: 1,
              },
              RaffleTask: {
                where: { task: { active: true } },
                include: { task: true },
                orderBy: { id: "asc" },
              },
            },
          })
        : [];

      const taskIds = raffles.flatMap((r) => r.RaffleTask.map((rt) => rt.taskId));
      const completions = taskIds.length
        ? await prisma.taskCompletion.findMany({
            where: { userId: user.id, taskId: { in: taskIds } },
            select: { taskId: true, status: true },
          })
        : [];
      const byTask = new Map(completions.map((c) => [c.taskId, c.status]));
      const socialLogs = raffles.length
        ? await prisma.log.findMany({
            where: {
              actorId: user.id,
              raffleId: { in: raffles.map((r) => r.id) },
              action: { in: [LEGACY_TASK_CLICK, LEGACY_TASK_VERIFY] },
            },
            select: { raffleId: true, action: true, metadata: true },
          })
        : [];
      const socialByTask = socialStatusMap(socialLogs);

      const xLinked = Boolean(
        await prisma.connectedAccount.findUnique({
          where: { userId_provider: { userId: user.id, provider: "X" } },
          select: { id: true },
        }),
      );

      return NextResponse.json({
        xLinked,
        raffles: raffles.map((raffle) => ({
          id: raffle.id,
          org: orgByGuild.get(raffle.guildId) ?? null,
          projectName: raffle.projectName,
          title: raffle.title,
          description: raffle.description,
          status: raffle.status,
          endAt: raffle.endAt,
          spots: raffle.spots,
          entryCount: raffle.hideEntries ? null : raffle.entryCount,
          bannerUrl: raffle.bannerUrl,
          entered: raffle.participants.length > 0,
          enteredAt: raffle.participants[0]?.enteredAt ?? null,
          tasks: [
            ...raffle.RaffleTask.map((rt) => ({
              id: rt.task.id,
              kind: "VERIFICATION",
              type: rt.task.type,
              typeLabel: TASK_TYPE_LABELS[rt.task.type],
              title: rt.task.title,
              description: rt.task.description,
              required: rt.required,
              points: rt.task.points,
              active: rt.task.active,
              actionUrl: taskActionUrl(rt.task.type, (rt.task.config ?? {}) as TaskConfig),
              status: byTask.get(rt.taskId) ?? "NOT_STARTED",
              verifiable: true,
            })),
            ...getLegacyRaffleTasks(raffle.id, raffle.requirements).map((task) =>
              legacyTaskRow(task, socialByTask.get(task.key)),
            ),
          ],
        })),
      });
    }

    const raffleId = Number(raffleParam);
    if (!Number.isFinite(raffleId)) {
      return NextResponse.json({ error: "raffle query param must be a number" }, { status: 400 });
    }

    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        projectName: true,
        title: true,
        status: true,
        requirements: true,
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
    const socialTasks = getLegacyRaffleTasks(raffle.id, raffle.requirements);
    const socialLogs = socialTasks.length
      ? await prisma.log.findMany({
          where: {
            actorId: user.id,
            raffleId: raffle.id,
            action: { in: [LEGACY_TASK_CLICK, LEGACY_TASK_VERIFY] },
          },
          select: { raffleId: true, action: true, metadata: true },
        })
      : [];
    const socialByTask = socialStatusMap(socialLogs);

    return NextResponse.json({
      raffle: {
        id: raffle.id,
        projectName: raffle.projectName,
        title: raffle.title,
        status: raffle.status,
      },
      xLinked,
      tasks: [
        ...raffle.RaffleTask.map((rt) => {
          const c = byTask.get(rt.taskId);
          return {
            id: rt.task.id,
            kind: "VERIFICATION",
            type: rt.task.type,
            typeLabel: TASK_TYPE_LABELS[rt.task.type],
            title: rt.task.title,
            description: rt.task.description,
            required: rt.required,
            points: rt.task.points,
            active: rt.task.active,
            actionUrl: taskActionUrl(rt.task.type, (rt.task.config ?? {}) as TaskConfig),
            status: c?.status ?? "NOT_STARTED",
            verifiable: true,
          };
        }),
        ...socialTasks.map((task) => legacyTaskRow(task, socialByTask.get(task.key))),
      ],
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function legacyTaskRow(
  task: { id: string; key: string; label: string; url: string | null },
  status?: { clicked: boolean; verified: boolean },
) {
  return {
    id: task.id,
    kind: "SOCIAL",
    type: "SOCIAL_TASK",
    typeLabel: "Raffle step",
    title: task.label,
    description: task.url
      ? "Open the link, complete the step, then verify it here."
      : "Complete this step, then verify it here.",
    required: true,
    points: 0,
    active: true,
    actionUrl: task.url,
    status: status?.verified ? "VERIFIED" : status?.clicked ? "CLICKED" : "ACTION_REQUIRED",
    verifiable: true,
    requiresClick: Boolean(task.url),
    clicked: Boolean(status?.clicked || status?.verified || !task.url),
  };
}

function socialStatusMap(logs: { action: string; metadata: unknown }[]) {
  const map = new Map<string, { clicked: boolean; verified: boolean }>();
  for (const log of logs) {
    const key = ((log.metadata ?? {}) as { taskKey?: unknown }).taskKey;
    if (typeof key !== "string") continue;
    const current = map.get(key) ?? { clicked: false, verified: false };
    if (log.action === LEGACY_TASK_CLICK) current.clicked = true;
    if (log.action === LEGACY_TASK_VERIFY) {
      current.clicked = true;
      current.verified = true;
    }
    map.set(key, current);
  }
  return map;
}
