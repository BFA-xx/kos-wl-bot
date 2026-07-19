import {
  CampaignEnrollmentStatus,
  CampaignStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

type CampaignTx = Prisma.TransactionClient;

export interface CampaignProgressStep {
  kind: "TASK" | "RAFFLE";
  id: string;
  taskId?: string;
  raffleId?: number;
  title: string;
  required: boolean;
  done: boolean;
  position: number;
}

export interface CampaignProgressSnapshot {
  steps: CampaignProgressStep[];
  done: number;
  total: number;
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
}

export interface CampaignSyncResult {
  campaignId: string;
  organizationId: string;
  title: string;
  completedNow: boolean;
  awardedPoints: number;
  progress: CampaignProgressSnapshot;
}

/** Derive stable campaign totals from resolved step state. */
export function summarizeCampaignProgress(
  steps: CampaignProgressStep[],
): Omit<CampaignProgressSnapshot, "steps"> {
  const required = steps.filter((step) => step.required);
  const requiredDone = required.filter((step) => step.done).length;
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    requiredDone,
    requiredTotal: required.length,
    // A campaign must have at least one required step before it can complete.
    complete: required.length > 0 && requiredDone === required.length,
  };
}

/** Read a campaign's task/raffle completion state without mutating it. */
export async function campaignProgressSnapshot(
  db: CampaignTx | PrismaClient,
  campaignId: string,
  userId: string,
): Promise<CampaignProgressSnapshot | null> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      tasks: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          taskId: true,
          required: true,
          position: true,
          task: { select: { title: true } },
        },
      },
      raffles: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          raffleId: true,
          required: true,
          position: true,
          raffle: { select: { projectName: true, title: true } },
        },
      },
    },
  });
  if (!campaign) return null;

  const taskIds = campaign.tasks.map((step) => step.taskId);
  const raffleIds = campaign.raffles.map((step) => step.raffleId);
  const [completions, entries] = await Promise.all([
    taskIds.length
      ? db.taskCompletion.findMany({
          where: { userId, taskId: { in: taskIds }, status: "VERIFIED" },
          select: { taskId: true },
        })
      : [],
    raffleIds.length
      ? db.participant.findMany({
          where: { userId, raffleId: { in: raffleIds } },
          select: { raffleId: true },
        })
      : [],
  ]);
  const doneTasks = new Set(completions.map((row) => row.taskId));
  const enteredRaffles = new Set(entries.map((row) => row.raffleId));
  const steps: CampaignProgressStep[] = [
    ...campaign.tasks.map((step) => ({
      kind: "TASK" as const,
      id: step.id,
      taskId: step.taskId,
      title: step.task.title,
      required: step.required,
      done: doneTasks.has(step.taskId),
      position: step.position,
    })),
    ...campaign.raffles.map((step) => ({
      kind: "RAFFLE" as const,
      id: step.id,
      raffleId: step.raffleId,
      title: `${step.raffle.projectName} · ${step.raffle.title}`,
      required: step.required,
      done: enteredRaffles.has(step.raffleId),
      position: step.position,
    })),
  ].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  return {
    steps,
    ...summarizeCampaignProgress(steps),
  };
}

/**
 * Mark an enrolled member complete and award the campaign bonus once. The
 * enrollment transition and append-only ledger insert are both idempotent.
 */
export async function syncCampaignProgress(
  db: PrismaClient,
  campaignId: string,
  userId: string,
): Promise<CampaignSyncResult | null> {
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        status: true,
        startAt: true,
        endAt: true,
        completionPoints: true,
        organization: { select: { suspendedAt: true } },
      },
    });
    if (!campaign) return null;
    const progress = await campaignProgressSnapshot(tx, campaignId, userId);
    if (!progress) return null;
    const enrollment = await tx.campaignEnrollment.findUnique({
      where: { campaignId_userId: { campaignId, userId } },
      select: { status: true },
    });
    if (!enrollment) {
      return {
        campaignId,
        organizationId: campaign.organizationId,
        title: campaign.title,
        completedNow: false,
        awardedPoints: 0,
        progress,
      };
    }

    const now = new Date();
    const active =
      campaign.status === CampaignStatus.LIVE &&
      campaign.organization.suspendedAt === null &&
      (!campaign.startAt || campaign.startAt <= now) &&
      (!campaign.endAt || campaign.endAt > now);
    if (
      !active ||
      !progress.complete ||
      enrollment.status === CampaignEnrollmentStatus.COMPLETED
    ) {
      return {
        campaignId,
        organizationId: campaign.organizationId,
        title: campaign.title,
        completedNow: false,
        awardedPoints: 0,
        progress,
      };
    }

    const completed = await tx.campaignEnrollment.updateMany({
      where: {
        campaignId,
        userId,
        status: CampaignEnrollmentStatus.JOINED,
      },
      data: {
        status: CampaignEnrollmentStatus.COMPLETED,
        completedAt: now,
      },
    });
    if (completed.count === 0) {
      return {
        campaignId,
        organizationId: campaign.organizationId,
        title: campaign.title,
        completedNow: false,
        awardedPoints: 0,
        progress,
      };
    }

    let awardedPoints = 0;
    if (campaign.completionPoints > 0) {
      const award = await tx.pointsLedger.createMany({
        data: [
          {
            organizationId: campaign.organizationId,
            userId,
            delta: campaign.completionPoints,
            reason: `Campaign completed: ${campaign.title}`,
            sourceType: "CAMPAIGN_COMPLETE",
            sourceId: campaign.id,
          },
        ],
        skipDuplicates: true,
      });
      awardedPoints = award.count > 0 ? campaign.completionPoints : 0;
    }
    return {
      campaignId,
      organizationId: campaign.organizationId,
      title: campaign.title,
      completedNow: true,
      awardedPoints,
      progress,
    };
  });
}

/** Sync every live campaign containing a verified task for this member. */
export async function syncCampaignsForTask(
  db: PrismaClient,
  taskId: string,
  userId: string,
): Promise<CampaignSyncResult[]> {
  const links = await db.campaignTask.findMany({
    where: {
      taskId,
      campaign: {
        status: CampaignStatus.LIVE,
        enrollments: { some: { userId } },
      },
    },
    select: { campaignId: true },
  });
  const results = await Promise.all(
    links.map((link) => syncCampaignProgress(db, link.campaignId, userId)),
  );
  return results.filter((result): result is CampaignSyncResult =>
    Boolean(result),
  );
}

/** Sync every live campaign containing a newly entered raffle for this member. */
export async function syncCampaignsForRaffle(
  db: PrismaClient,
  raffleId: number,
  userId: string,
): Promise<CampaignSyncResult[]> {
  const links = await db.campaignRaffle.findMany({
    where: {
      raffleId,
      campaign: {
        status: CampaignStatus.LIVE,
        enrollments: { some: { userId } },
      },
    },
    select: { campaignId: true },
  });
  const results = await Promise.all(
    links.map((link) => syncCampaignProgress(db, link.campaignId, userId)),
  );
  return results.filter((result): result is CampaignSyncResult =>
    Boolean(result),
  );
}
