import {
  CollaborationStatus,
  CollaborationSubmissionStatus,
  CollaborationWalletStatus,
  RaffleStatus,
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
const AUTO_LINK_BATCH_SIZE = 50;
const REUSABLE_STATUSES = [
  CollaborationStatus.LEAD,
  CollaborationStatus.REACHED_OUT,
  CollaborationStatus.NEGOTIATING,
  CollaborationStatus.CONFIRMED,
  CollaborationStatus.SCHEDULED,
  CollaborationStatus.HOSTING,
  CollaborationStatus.COLLECTING_WALLETS,
  CollaborationStatus.READY_FOR_SUBMISSION,
] as const;
const TAG_COLORS = {
  GTD: "#8B5CF6",
  FCFS: "#3B82F6",
  WL: "#10B981",
} as const;
const RESERVED_X_PATHS = new Set([
  "home",
  "i",
  "intent",
  "search",
  "share",
  "status",
]);

interface AutomationCursor {
  lastActivityAt: string;
  id: string;
}

export function cleanProjectName(value: string): string {
  return (
    value
      .trim()
      .replace(/^kos\s*[x×]\s*/i, "")
      .replace(/[\s,;:!?._-]+$/g, "")
      .replace(/\s+/g, " ") || "Untitled partner"
  );
}

export function normalizedProjectName(value: string): string {
  return cleanProjectName(value).toLocaleLowerCase().replace(/\s+/g, " ");
}

export function projectKey(value: string): string {
  const compact = cleanProjectName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return compact.length > 4 ? compact.replace(/nft$/, "") : compact;
}

export function raffleVariant(projectName: string, title: string) {
  const value = `${projectName} ${title}`.toLowerCase();
  if (/\bfcfs\b/.test(value)) return "FCFS" as const;
  if (/\bgtds?\b/.test(value)) return "GTD" as const;
  return "WL" as const;
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function xProfileUrl(value: string | null): string | null {
  const normalized = httpUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (
    !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
      url.hostname.toLowerCase(),
    )
  ) {
    return null;
  }
  const handle = url.pathname.split("/").filter(Boolean)[0];
  if (
    !handle ||
    !/^[a-z0-9_]{1,15}$/i.test(handle) ||
    RESERVED_X_PATHS.has(handle.toLowerCase())
  ) {
    return null;
  }
  return `https://x.com/${handle.toLowerCase()}`;
}

/**
 * Ensure a successfully hosted raffle has one tenant-scoped Collab Hub link.
 * Existing active work for the same partner is reused; terminal relationships
 * remain historical and a new campaign record is created.
 */
export async function ensureCollaborationForRaffle(
  raffleId: number,
): Promise<string | null> {
  const existingLink = await prisma.collaborationRaffle.findUnique({
    where: { raffleId },
    select: { collaborationId: true },
  });
  if (existingLink) return existingLink.collaborationId;

  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      guildId: true,
      projectName: true,
      title: true,
      spots: true,
      status: true,
      startAt: true,
      endAt: true,
      createdById: true,
      externalUrl: true,
    },
  });
  if (!raffle || raffle.status === RaffleStatus.DRAFT) return null;

  const connection = await prisma.guildConnection.findUnique({
    where: { guildId: raffle.guildId },
    select: {
      organization: {
        select: {
          id: true,
          ownerId: true,
          members: {
            where: { status: "ACTIVE" },
            select: { userId: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!connection) return null;

  const org = connection.organization;
  const displayName = cleanProjectName(raffle.projectName);
  const normalizedName = normalizedProjectName(displayName);
  const key = projectKey(displayName);
  const xUrl = xProfileUrl(raffle.externalUrl);
  const websiteUrl = xUrl ? null : httpUrl(raffle.externalUrl);
  const partners = await prisma.collaborationPartner.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      normalizedName: true,
      websiteUrl: true,
      xUrl: true,
    },
  });
  const matchedPartner = partners.find(
    (partner) =>
      projectKey(partner.normalizedName) === key ||
      (xUrl && partner.xUrl?.toLowerCase() === xUrl.toLowerCase()),
  );
  const partner = matchedPartner
    ? await prisma.collaborationPartner.update({
        where: { id: matchedPartner.id },
        data: {
          websiteUrl: matchedPartner.websiteUrl ?? websiteUrl,
          xUrl: matchedPartner.xUrl ?? xUrl,
        },
      })
    : await prisma.collaborationPartner.upsert({
        where: {
          organizationId_normalizedName: {
            organizationId: org.id,
            normalizedName,
          },
        },
        create: {
          organizationId: org.id,
          name: displayName,
          normalizedName,
          websiteUrl,
          xUrl,
          createdById: raffle.createdById,
        },
        update: {
          name: displayName,
          ...(websiteUrl ? { websiteUrl } : {}),
          ...(xUrl ? { xUrl } : {}),
        },
      });

  const reusable = await prisma.collaboration.findFirst({
    where: {
      organizationId: org.id,
      partnerId: partner.id,
      archivedAt: null,
      status: { in: [...REUSABLE_STATUSES] },
    },
    include: {
      raffles: { select: { raffle: { select: { spots: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const teamIds = new Set(org.members.map((member) => member.userId));
  const hostedById = teamIds.has(raffle.createdById)
    ? raffle.createdById
    : (org.members[0]?.userId ?? org.ownerId);
  const variant = raffleVariant(raffle.projectName, raffle.title);
  const targetStatus =
    raffle.status === RaffleStatus.UPCOMING
      ? CollaborationStatus.SCHEDULED
      : CollaborationStatus.HOSTING;
  const requirementSummary = `Auto-linked raffle #${raffle.id} ${variant} (${raffle.spots} spots).`;

  try {
    return await prisma.$transaction(async (tx) => {
      const racedLink = await tx.collaborationRaffle.findUnique({
        where: { raffleId },
        select: { collaborationId: true },
      });
      if (racedLink) return racedLink.collaborationId;

      const collaboration = reusable
        ? await tx.collaboration.update({
            where: { id: reusable.id },
            data: {
              projectName: displayName,
              status: targetStatus,
              whitelistAllocation: Math.max(
                reusable.whitelistAllocation,
                reusable.raffles.reduce(
                  (total, link) => total + Math.max(0, link.raffle.spots),
                  Math.max(0, raffle.spots),
                ),
              ),
              requirements: [reusable.requirements, requirementSummary]
                .filter(Boolean)
                .join("\n"),
              ownerId: hostedById,
              hostAt:
                reusable.hostAt && reusable.hostAt < raffle.startAt
                  ? reusable.hostAt
                  : raffle.startAt,
              hostingDeadline:
                reusable.hostingDeadline &&
                reusable.hostingDeadline > raffle.endAt
                  ? reusable.hostingDeadline
                  : raffle.endAt,
              lastActivityAt: new Date(),
            },
          })
        : await tx.collaboration.create({
            data: {
              organizationId: org.id,
              partnerId: partner.id,
              projectName: displayName,
              status: targetStatus,
              priority: "MEDIUM",
              submissionStatus: CollaborationSubmissionStatus.NOT_STARTED,
              whitelistAllocation: Math.max(0, raffle.spots),
              requirements: requirementSummary,
              ownerId: hostedById,
              hostAt: raffle.startAt,
              hostingDeadline: raffle.endAt,
              lastActivityAt: new Date(),
              createdById: raffle.createdById,
            },
          });

      await tx.collaborationRaffle.create({
        data: {
          collaborationId: collaboration.id,
          raffleId,
          attachedById: raffle.createdById,
        },
      });
      const tag = await tx.collaborationTag.upsert({
        where: {
          organizationId_normalizedName: {
            organizationId: org.id,
            normalizedName: variant.toLowerCase(),
          },
        },
        create: {
          organizationId: org.id,
          name: variant,
          normalizedName: variant.toLowerCase(),
          color: TAG_COLORS[variant],
        },
        update: { name: variant, color: TAG_COLORS[variant] },
      });
      await tx.collaborationTagAssignment.createMany({
        data: [{ collaborationId: collaboration.id, tagId: tag.id }],
        skipDuplicates: true,
      });
      await tx.collaborationActivity.create({
        data: {
          collaborationId: collaboration.id,
          actorId: raffle.createdById,
          action: "RAFFLE_AUTO_LINKED",
          title: `Raffle #${raffle.id} connected automatically`,
          body: `${raffle.projectName} · ${raffle.title}`,
          metadata: { raffleId: raffle.id, variant },
        },
      });
      return collaboration.id;
    });
  } catch (error) {
    const racedLink = await prisma.collaborationRaffle.findUnique({
      where: { raffleId },
      select: { collaborationId: true },
    });
    if (racedLink) return racedLink.collaborationId;
    throw error;
  }
}

/** Reconcile the Collab Hub record linked to one raffle after a draw. */
export async function syncCollaborationForRaffle(
  raffleId: number,
): Promise<void> {
  const existing = await prisma.collaborationRaffle.findUnique({
    where: { raffleId },
    select: { collaborationId: true },
  });
  const collaborationId =
    existing?.collaborationId ?? (await ensureCollaborationForRaffle(raffleId));
  if (collaborationId) await syncCollaboration(collaborationId);
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
  await autoLinkHostedRaffles();
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

async function autoLinkHostedRaffles(): Promise<void> {
  const guildIds = (
    await prisma.guildConnection.findMany({ select: { guildId: true } })
  ).map((connection) => connection.guildId);
  if (!guildIds.length) return;
  const raffles = await prisma.raffle.findMany({
    where: {
      guildId: { in: guildIds },
      status: {
        in: [RaffleStatus.UPCOMING, RaffleStatus.LIVE, RaffleStatus.ENDED],
      },
      messageId: { not: null },
      collaborationLink: { is: null },
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: AUTO_LINK_BATCH_SIZE,
  });
  for (const raffle of raffles) {
    await syncCollaborationForRaffle(raffle.id).catch((error) =>
      logger.warn(
        { error, raffleId: raffle.id },
        "hosted raffle Collab Hub auto-link sync failed",
      ),
    );
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
