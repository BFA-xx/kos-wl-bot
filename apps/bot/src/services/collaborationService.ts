import {
  CollaborationStatus,
  CollaborationSubmissionStatus,
  CollaborationWalletStatus,
  prisma,
} from "@kos/db";
import { logger } from "../logger.js";

const TERMINAL = new Set<CollaborationStatus>([
  CollaborationStatus.SUBMITTED,
  CollaborationStatus.COMPLETED,
  CollaborationStatus.CANCELLED,
]);
const ACTIVE_BATCH_SIZE = 100;
const REMINDER_BATCH_SIZE = 50;
const REMINDER_TIME_BUDGET_MS = 20_000;
const AUTOMATION_CURSOR_KEY = "collab-automation-cursor";

interface AutomationCursor {
  lastActivityAt: string;
  id: string;
}

/** Reconcile the Collab Hub record linked to one raffle after a draw. */
export async function syncCollaborationForRaffle(
  raffleId: number,
): Promise<void> {
  const link = await prisma.collaborationRaffle.findUnique({
    where: { raffleId },
    select: { collaborationId: true },
  });
  if (link) await syncCollaboration(link.collaborationId);
}

async function syncCollaboration(collaborationId: string): Promise<void> {
  const collaboration = await prisma.collaboration.findUnique({
    where: { id: collaborationId },
    include: {
      wallets: true,
      raffles: {
        include: {
          raffle: {
            select: {
              id: true,
              status: true,
              walletChains: true,
              winners: {
                where: { replaced: false },
                include: {
                  wallet: true,
                  user: { include: { walletProfiles: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!collaboration) return;
  const existingByUser = new Map(
    collaboration.wallets.map((wallet) => [wallet.userId, wallet]),
  );
  const seen = new Set<string>();
  for (const link of collaboration.raffles) {
    for (const winner of link.raffle.winners) {
      if (seen.has(winner.userId)) continue;
      seen.add(winner.userId);
      const current = existingByUser.get(winner.userId);
      const profile =
        link.raffle.walletChains
          .map((chain) =>
            winner.user.walletProfiles.find((item) => item.chain === chain),
          )
          .find(Boolean) ??
        winner.user.walletProfiles[0] ??
        null;
      const source = winner.wallet ?? profile;
      const detected = source
        ? CollaborationWalletStatus.COLLECTED
        : CollaborationWalletStatus.WAITING;
      const status =
        current && current.status !== CollaborationWalletStatus.WAITING
          ? current.status
          : detected;
      await prisma.collaborationWallet.upsert({
        where: {
          collaborationId_userId: {
            collaborationId: collaboration.id,
            userId: winner.userId,
          },
        },
        create: {
          collaborationId: collaboration.id,
          userId: winner.userId,
          winnerId: winner.id,
          chain: source?.chain ?? null,
          status,
        },
        update: {
          winnerId: current?.winnerId ?? winner.id,
          chain: source?.chain ?? current?.chain ?? null,
          status,
        },
      });
    }
  }
  if (
    TERMINAL.has(collaboration.status) ||
    collaboration.raffles.length === 0
  ) {
    return;
  }
  const wallets = await prisma.collaborationWallet.findMany({
    where: { collaborationId: collaboration.id },
    select: { status: true },
  });
  const allEnded = collaboration.raffles.every((link) =>
    ["ENDED", "CANCELLED"].includes(link.raffle.status),
  );
  const required = Math.max(collaboration.whitelistAllocation, wallets.length);
  const collected = wallets.filter(
    (wallet) =>
      wallet.status === CollaborationWalletStatus.COLLECTED ||
      wallet.status === CollaborationWalletStatus.SUBMITTED,
  ).length;
  let status: CollaborationStatus;
  let submissionStatus: CollaborationSubmissionStatus | undefined;
  if (!allEnded) {
    status = CollaborationStatus.HOSTING;
  } else if (required > 0 && collected >= required) {
    status = CollaborationStatus.READY_FOR_SUBMISSION;
    submissionStatus = CollaborationSubmissionStatus.READY;
  } else {
    status = CollaborationStatus.COLLECTING_WALLETS;
    submissionStatus = CollaborationSubmissionStatus.COLLECTING;
  }
  if (
    status !== collaboration.status ||
    (submissionStatus && submissionStatus !== collaboration.submissionStatus)
  ) {
    await prisma.$transaction([
      prisma.collaboration.update({
        where: { id: collaboration.id },
        data: { status, submissionStatus, lastActivityAt: new Date() },
      }),
      prisma.collaborationActivity.create({
        data: {
          collaborationId: collaboration.id,
          action: "AUTOMATION_STATUS",
          title: `Pipeline moved to ${status.replaceAll("_", " ").toLowerCase()}`,
          body: "Updated automatically from attached raffle and wallet progress.",
          metadata: { required, collected },
        },
      }),
    ]);
  }
}

/** Sweep active records and deliver organization-team reminder notifications. */
export async function processCollaborationAutomations(): Promise<void> {
  let cursor = await readAutomationCursor();
  let active = await findActiveBatch(cursor);
  if (!active.length && cursor) {
    cursor = null;
    active = await findActiveBatch(null);
  }
  for (const collaboration of active) {
    await syncCollaboration(collaboration.id).catch((error) =>
      logger.warn(
        { error, collaborationId: collaboration.id },
        "collaboration automation sync failed",
      ),
    );
    const inactiveAt = new Date(
      collaboration.lastActivityAt.getTime() +
        collaboration.noResponseDays * 86_400_000,
    );
    if (inactiveAt <= new Date()) {
      const existing = await prisma.collaborationReminder.findFirst({
        where: {
          collaborationId: collaboration.id,
          type: "INACTIVE",
          completedAt: null,
        },
      });
      if (!existing) {
        await prisma.collaborationReminder.create({
          data: {
            collaborationId: collaboration.id,
            type: "INACTIVE",
            title: `No activity for ${collaboration.noResponseDays} days`,
            dueAt: new Date(),
            automatic: true,
          },
        });
      }
    }
  }
  if (active.length === ACTIVE_BATCH_SIZE) {
    const last = active.at(-1)!;
    await writeAutomationCursor({
      lastActivityAt: last.lastActivityAt.toISOString(),
      id: last.id,
    });
  } else {
    await writeAutomationCursor(null);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < REMINDER_TIME_BUDGET_MS) {
    const processed = await processReminderBatch();
    if (processed < REMINDER_BATCH_SIZE) break;
  }
}

async function findActiveBatch(cursor: AutomationCursor | null) {
  return prisma.collaboration.findMany({
    where: {
      archivedAt: null,
      status: { notIn: [...TERMINAL] },
      ...(cursor
        ? {
            OR: [
              { lastActivityAt: { gt: new Date(cursor.lastActivityAt) } },
              {
                lastActivityAt: new Date(cursor.lastActivityAt),
                id: { gt: cursor.id },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      organizationId: true,
      projectName: true,
      noResponseDays: true,
      lastActivityAt: true,
    },
    orderBy: [{ lastActivityAt: "asc" }, { id: "asc" }],
    take: ACTIVE_BATCH_SIZE,
  });
}

async function readAutomationCursor(): Promise<AutomationCursor | null> {
  const record = await prisma.systemStatus.findUnique({
    where: { key: AUTOMATION_CURSOR_KEY },
    select: { value: true },
  });
  if (!record?.value) return null;
  try {
    const parsed = JSON.parse(record.value) as Partial<AutomationCursor>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.lastActivityAt === "string" &&
      Number.isFinite(new Date(parsed.lastActivityAt).getTime())
    ) {
      return { id: parsed.id, lastActivityAt: parsed.lastActivityAt };
    }
  } catch {
    // A malformed operational cursor is safe to reset from the first page.
  }
  return null;
}

async function writeAutomationCursor(cursor: AutomationCursor | null) {
  await prisma.systemStatus.upsert({
    where: { key: AUTOMATION_CURSOR_KEY },
    create: {
      key: AUTOMATION_CURSOR_KEY,
      value: cursor ? JSON.stringify(cursor) : null,
    },
    update: { value: cursor ? JSON.stringify(cursor) : null },
  });
}

async function processReminderBatch(): Promise<number> {
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const reminders = await prisma.collaborationReminder.findMany({
    where: { dueAt: { lte: horizon }, completedAt: null, notifiedAt: null },
    include: {
      collaboration: {
        select: {
          id: true,
          projectName: true,
          organization: {
            select: {
              id: true,
              slug: true,
              ownerId: true,
              members: {
                where: { status: "ACTIVE" },
                select: {
                  userId: true,
                  role: { select: { permissions: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { dueAt: "asc" },
    take: REMINDER_BATCH_SIZE,
  });
  let delivered = 0;
  for (const reminder of reminders) {
    const claimed = await prisma.collaborationReminder.updateMany({
      where: { id: reminder.id, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    if (!claimed.count) continue;
    const organization = reminder.collaboration.organization;
    const recipients = new Set<string>([organization.ownerId]);
    for (const member of organization.members) {
      if (member.role.permissions.includes("collab:view"))
        recipients.add(member.userId);
    }
    try {
      await prisma.notification.createMany({
        data: [...recipients].map((userId) => ({
          userId,
          type: "COLLAB_REMINDER",
          title: reminder.title,
          body: `${reminder.collaboration.projectName} · due ${reminder.dueAt.toISOString()}`,
          link: `/${organization.slug}/collabs/${reminder.collaboration.id}`,
        })),
      });
      delivered += 1;
    } catch (error) {
      await prisma.collaborationReminder
        .update({ where: { id: reminder.id }, data: { notifiedAt: null } })
        .catch(() => undefined);
      logger.warn(
        { error, reminderId: reminder.id },
        "collaboration reminder delivery failed",
      );
    }
  }
  return delivered;
}
