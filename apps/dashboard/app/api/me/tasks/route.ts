import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { TASK_TYPE_LABELS, taskActionUrl, type TaskConfig } from "@/lib/verify";
import type { CompletionStatus, Prisma, TaskDefinition } from "@prisma/client";
import {
  getLegacyRaffleTasks,
  LEGACY_TASK_CLICK,
  LEGACY_TASK_VERIFY,
  TASK_DEFINITION_CLICK,
} from "@/lib/legacy-raffle-tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Tasks for the signed-in participant.
 *
 * - Without a query param, this returns the profile Tasks hub: standalone
 *   earning tasks, live raffles, and a separate recent-ended raffle collection
 *   from public KOS communities, all with the caller's completion state.
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
      const orgIds = orgs.map((org) => org.id);

      const standaloneTasks = orgIds.length
        ? await prisma.taskDefinition.findMany({
            where: {
              organizationId: { in: orgIds },
              active: true,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          })
        : [];
      const raffleSelect = {
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
          include: { task: true },
          orderBy: { id: "asc" },
        },
      } satisfies Prisma.RaffleSelect;
      const [raffles, endedRaffles] = guildIds.length
        ? await Promise.all([
            prisma.raffle.findMany({
              where: { guildId: { in: guildIds }, status: "LIVE" },
              orderBy: { endAt: "asc" },
              take: 50,
              select: raffleSelect,
            }),
            prisma.raffle.findMany({
              where: { guildId: { in: guildIds }, status: "ENDED" },
              orderBy: { endAt: "desc" },
              take: 30,
              select: raffleSelect,
            }),
          ])
        : [[], []];
      const visibleRaffles = [...raffles, ...endedRaffles];

      const taskIds = [
        ...standaloneTasks.map((task) => task.id),
        ...visibleRaffles.flatMap((r) => r.RaffleTask.map((rt) => rt.taskId)),
      ];
      const completions = taskIds.length
        ? await prisma.taskCompletion.findMany({
            where: { userId: user.id, taskId: { in: taskIds } },
            select: { taskId: true, status: true },
          })
        : [];
      const byTask = new Map(completions.map((c) => [c.taskId, c.status]));
      const taskClickLogs =
        taskIds.length && guildIds.length
          ? await prisma.log.findMany({
              where: {
                actorId: user.id,
                guildId: { in: guildIds },
                action: TASK_DEFINITION_CLICK,
              },
              select: { metadata: true },
            })
          : [];
      const clickedTaskIds = new Set(
        taskClickLogs.flatMap((log) => {
          const metadata = log.metadata as { taskId?: unknown } | null;
          return typeof metadata?.taskId === "string" ? [metadata.taskId] : [];
        }),
      );
      const balances = orgIds.length
        ? await prisma.pointsLedger.groupBy({
            by: ["organizationId"],
            where: { userId: user.id, organizationId: { in: orgIds } },
            _sum: { delta: true },
          })
        : [];
      const balanceByOrg = new Map(
        balances.map((row) => [row.organizationId, row._sum.delta ?? 0]),
      );
      const socialLogs = visibleRaffles.length
        ? await prisma.log.findMany({
            where: {
              actorId: user.id,
              action: { in: [LEGACY_TASK_CLICK, LEGACY_TASK_VERIFY] },
            },
            select: { action: true, metadata: true },
          })
        : [];
      const socialByTask = socialStatusMap(socialLogs);

      const xLinked = Boolean(
        await prisma.connectedAccount.findUnique({
          where: { userId_provider: { userId: user.id, provider: "X" } },
          select: { id: true },
        }),
      );

      const raffleRow = (
        raffle: (typeof visibleRaffles)[number],
        historical: boolean,
      ) => ({
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
          ...raffle.RaffleTask.filter((rt) => historical || rt.task.active).map(
            (rt) => ({
              ...taskRow(
                rt.task,
                byTask.get(rt.taskId),
                clickedTaskIds.has(rt.taskId),
                rt.required,
              ),
              source: "RAFFLE",
            }),
          ),
          ...getLegacyRaffleTasks(raffle.id, raffle.requirements).map((task) =>
            legacyTaskRow(
              task,
              socialByTask.get(task.key) ??
                (task.sharedKey ? socialByTask.get(task.sharedKey) : undefined),
            ),
          ),
        ],
      });

      return NextResponse.json({
        xLinked,
        taskGroups: orgs
          .map((org) => {
            const tasks = standaloneTasks.filter(
              (task) => task.organizationId === org.id,
            );
            const guildId = org.guildConnections[0]?.guildId ?? null;
            return {
              org: {
                id: org.id,
                slug: org.slug,
                name: org.name,
                logoUrl: org.logoUrl,
                guildId,
              },
              balance: balanceByOrg.get(org.id) ?? 0,
              tasks: tasks.map((task) =>
                taskRow(
                  task,
                  byTask.get(task.id),
                  clickedTaskIds.has(task.id),
                  false,
                ),
              ),
            };
          })
          .filter((group) => group.tasks.length > 0),
        raffles: raffles.map((raffle) => raffleRow(raffle, false)),
        endedRaffles: endedRaffles.map((raffle) => raffleRow(raffle, true)),
      });
    }

    const raffleId = Number(raffleParam);
    if (!Number.isFinite(raffleId)) {
      return NextResponse.json(
        { error: "raffle query param must be a number" },
        { status: 400 },
      );
    }

    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
      select: {
        id: true,
        guildId: true,
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
    if (!raffle)
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });

    const taskIds = raffle.RaffleTask.map((rt) => rt.taskId);
    const completions = taskIds.length
      ? await prisma.taskCompletion.findMany({
          where: { userId: user.id, taskId: { in: taskIds } },
        })
      : [];
    const byTask = new Map(completions.map((c) => [c.taskId, c]));
    const taskClickLogs = taskIds.length
      ? await prisma.log.findMany({
          where: {
            actorId: user.id,
            guildId: raffle.guildId,
            action: TASK_DEFINITION_CLICK,
          },
          select: { metadata: true },
        })
      : [];
    const clickedTaskIds = new Set(
      taskClickLogs.flatMap((log) => {
        const metadata = log.metadata as { taskId?: unknown } | null;
        return typeof metadata?.taskId === "string" ? [metadata.taskId] : [];
      }),
    );

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
            action: { in: [LEGACY_TASK_CLICK, LEGACY_TASK_VERIFY] },
          },
          select: { action: true, metadata: true },
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
            ...taskRow(
              rt.task,
              c?.status,
              clickedTaskIds.has(rt.taskId),
              rt.required,
            ),
            source: "RAFFLE",
          };
        }),
        ...socialTasks.map((task) =>
          legacyTaskRow(
            task,
            socialByTask.get(task.key) ??
              (task.sharedKey ? socialByTask.get(task.sharedKey) : undefined),
          ),
        ),
      ],
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function taskRow(
  task: TaskDefinition,
  status: CompletionStatus | undefined,
  clicked: boolean,
  required: boolean,
) {
  const cfg = (task.config ?? {}) as TaskConfig;
  const actionUrl = taskActionUrl(task.type, cfg);
  const requiresClick = requiresOpenBeforeVerify(task, actionUrl);
  const verified = status === "VERIFIED";
  const waitingForReview = status === "NEEDS_REVIEW";
  const opened = clicked || verified || !requiresClick;

  return {
    id: task.id,
    kind: "VERIFICATION",
    source: "STANDALONE",
    type: task.type,
    typeLabel: TASK_TYPE_LABELS[task.type],
    title: task.title,
    description:
      task.description ??
      (requiresClick
        ? "Open the task, complete it, then verify here to earn points."
        : null),
    required,
    points: task.points,
    active: task.active,
    actionUrl,
    status: verified
      ? "VERIFIED"
      : waitingForReview
        ? "NEEDS_REVIEW"
        : requiresClick
          ? opened
            ? "CLICKED"
            : "ACTION_REQUIRED"
          : (status ?? "NOT_STARTED"),
    verifiable: true,
    requiresClick,
    clicked: opened,
  };
}

function requiresOpenBeforeVerify(
  task: TaskDefinition,
  actionUrl: string | null,
) {
  if (!actionUrl) return false;
  return (
    task.type === "X_FOLLOW" ||
    task.type === "X_LIKE" ||
    task.type === "X_REPOST" ||
    task.type === "X_COMMENT" ||
    task.type === "VISIT_LINK"
  );
}

function legacyTaskRow(
  task: {
    id: string;
    key: string;
    sharedKey: string | null;
    label: string;
    url: string | null;
  },
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
    status: status?.verified
      ? "VERIFIED"
      : status?.clicked
        ? "CLICKED"
        : "ACTION_REQUIRED",
    verifiable: true,
    requiresClick: Boolean(task.url),
    clicked: Boolean(status?.clicked || status?.verified || !task.url),
  };
}

function socialStatusMap(logs: { action: string; metadata: unknown }[]) {
  const map = new Map<string, { clicked: boolean; verified: boolean }>();
  for (const log of logs) {
    const metadata = (log.metadata ?? {}) as {
      taskKey?: unknown;
      sharedTaskKey?: unknown;
    };
    const keys = [metadata.taskKey, metadata.sharedTaskKey].filter(
      (key): key is string => typeof key === "string",
    );
    for (const key of keys) {
      const current = map.get(key) ?? { clicked: false, verified: false };
      if (log.action === LEGACY_TASK_CLICK) current.clicked = true;
      if (log.action === LEGACY_TASK_VERIFY) {
        current.clicked = true;
        current.verified = true;
      }
      map.set(key, current);
    }
  }
  return map;
}
