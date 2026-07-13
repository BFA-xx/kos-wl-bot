import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  ACTIVE_COLLAB_STATUSES,
  COLLAB_PRIORITIES,
  COLLAB_STATUSES,
  isCollabPriority,
  isCollabStatus,
  normalizeCollabName,
  toOptionalDate,
} from "@/lib/collab-shared";
import { sanitizeHttpUrl } from "@/lib/raffle-input";
import { buildAllTimeActivityHistory } from "@/lib/collab-presentation";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function walletProgress(allocation: number, wallets: { status: string }[]) {
  const collected = wallets.filter(
    (wallet) => wallet.status === "COLLECTED" || wallet.status === "SUBMITTED",
  ).length;
  const submitted = wallets.filter(
    (wallet) => wallet.status === "SUBMITTED",
  ).length;
  const rejected = wallets.filter(
    (wallet) => wallet.status === "REJECTED",
  ).length;
  const total = Math.max(allocation, wallets.length);
  return {
    total,
    collected,
    submitted,
    rejected,
    remaining: Math.max(0, total - collected - rejected),
    percent: total ? Math.min(100, Math.round((collected / total) * 100)) : 0,
  };
}

export const GET = withAccess(async (req, { params }) => {
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_VIEW,
  );
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const chain = url.searchParams.get("chain")?.trim().slice(0, 40) ?? "";
  const ownerFilter = url.searchParams.get("owner")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const archived = url.searchParams.get("archived") === "1";
  const sort = url.searchParams.get("sort") ?? "updatedAt";
  const direction =
    url.searchParams.get("direction") === "asc" ? "asc" : "desc";
  const allowedSort = new Set([
    "projectName",
    "status",
    "priority",
    "hostAt",
    "walletSubmissionDeadline",
    "updatedAt",
    "whitelistAllocation",
  ]);
  const orderField = allowedSort.has(sort) ? sort : "updatedAt";
  const activeStatus = status === "ACTIVE";

  const where: Prisma.CollaborationWhereInput = {
    organizationId: org.id,
    archivedAt: archived ? { not: null } : null,
    ...(activeStatus
      ? { status: { in: [...ACTIVE_COLLAB_STATUSES] } }
      : isCollabStatus(status)
        ? { status }
        : {}),
    ...(isCollabPriority(priority) ? { priority } : {}),
    ...(chain
      ? { partner: { chain: { equals: chain, mode: "insensitive" } } }
      : {}),
    ...(ownerFilter
      ? {
          OR: [
            { ownerId: ownerFilter },
            { assignedToId: ownerFilter },
            { reviewerId: ownerFilter },
          ],
        }
      : {}),
    ...(tag ? { tags: { some: { tagId: tag } } } : {}),
    ...(q
      ? {
          OR: [
            { projectName: { contains: q, mode: "insensitive" } },
            { primaryContactName: { contains: q, mode: "insensitive" } },
            { discordUsername: { contains: q, mode: "insensitive" } },
            { requirements: { contains: q, mode: "insensitive" } },
            {
              partner: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { discordUrl: { contains: q, mode: "insensitive" } },
                  { xUrl: { contains: q, mode: "insensitive" } },
                  { category: { contains: q, mode: "insensitive" } },
                ],
              },
            },
            {
              tags: {
                some: { tag: { name: { contains: q, mode: "insensitive" } } },
              },
            },
          ],
        }
      : {}),
  };

  const [
    collaborations,
    members,
    tags,
    savedFilters,
    analyticsRows,
    unlinkedHistoryRows,
    linkedRafflesAllTime,
  ] = await Promise.all([
    prisma.collaboration.findMany({
      where,
      orderBy: { [orderField]: direction },
      take: 250,
      include: {
        partner: true,
        tags: { include: { tag: true } },
        wallets: { select: { status: true } },
        raffles: {
          include: {
            raffle: {
              select: {
                id: true,
                projectName: true,
                title: true,
                status: true,
                bannerUrl: true,
                spots: true,
                entryCount: true,
                endAt: true,
              },
            },
          },
        },
        reminders: {
          where: { completedAt: null },
          select: { id: true, title: true, type: true, dueAt: true },
          orderBy: { dueAt: "asc" },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: org.id, status: "ACTIVE" },
      include: { user: true, role: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.collaborationTag.findMany({
      where: { organizationId: org.id },
      orderBy: { name: "asc" },
    }),
    prisma.collaborationSavedFilter.findMany({
      where: { organizationId: org.id },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.collaboration.findMany({
      where: { organizationId: org.id, archivedAt: null },
      select: {
        id: true,
        status: true,
        whitelistAllocation: true,
        hostAt: true,
        hostingDeadline: true,
        completedAt: true,
        createdAt: true,
        assignedToId: true,
        ownerId: true,
        partnerId: true,
        partner: { select: { name: true } },
        wallets: { select: { status: true } },
        raffles: { select: { id: true } },
      },
    }),
    prisma.raffle.findMany({
      where: {
        guildId: { in: guildIds },
        status: { in: ["ENDED", "CANCELLED"] },
        collaborationLink: { is: null },
      },
      select: { projectName: true, title: true },
    }),
    prisma.collaborationRaffle.count({
      where: { collaboration: { organizationId: org.id } },
    }),
  ]);

  const rows = collaborations.map((collaboration) => ({
    ...collaboration,
    walletProgress: walletProgress(
      collaboration.whitelistAllocation,
      collaboration.wallets,
    ),
  }));

  const now = new Date();
  const { start, end } = dayBounds(now);
  const globalRows = analyticsRows.map((row) => ({
    ...row,
    walletProgress: walletProgress(row.whitelistAllocation, row.wallets),
  }));
  const active = globalRows.filter((row) =>
    ACTIVE_COLLAB_STATUSES.includes(row.status),
  );
  const summary = {
    active: active.length,
    hostingToday: globalRows.filter((row) => {
      const date = row.hostAt ?? row.hostingDeadline;
      return date && date >= start && date < end;
    }).length,
    waitingForWallets: globalRows.filter(
      (row) => row.status === "COLLECTING_WALLETS",
    ).length,
    readyForSubmission: globalRows.filter(
      (row) => row.status === "READY_FOR_SUBMISSION",
    ).length,
    completedAllTime: globalRows.filter((row) => row.status === "COMPLETED")
      .length,
    totalWlSpots: globalRows.reduce(
      (sum, row) => sum + Math.max(0, row.whitelistAllocation),
      0,
    ),
    linkedRafflesAllTime,
    unlinkedRaffles: unlinkedHistoryRows.length,
  };

  const [recentActivity, recentNotes, reminders] = await Promise.all([
    prisma.collaborationActivity.findMany({
      where: { collaboration: { organizationId: org.id, archivedAt: null } },
      include: { collaboration: { select: { id: true, projectName: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.collaborationNote.findMany({
      where: { collaboration: { organizationId: org.id, archivedAt: null } },
      include: { collaboration: { select: { id: true, projectName: true } } },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
    prisma.collaborationReminder.findMany({
      where: {
        collaboration: { organizationId: org.id, archivedAt: null },
        completedAt: null,
      },
      include: { collaboration: { select: { id: true, projectName: true } } },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
  ]);

  const peopleById = new Map<
    string,
    { id: string; name: string; avatarUrl: string | null; role: string }
  >();
  for (const member of members) {
    peopleById.set(member.userId, {
      id: member.userId,
      name: member.user.globalName ?? member.user.username,
      avatarUrl: member.user.avatarUrl,
      role: member.role.name,
    });
  }

  const completed = globalRows.filter((row) => row.status === "COMPLETED");
  const decided = globalRows.filter(
    (row) => row.status === "COMPLETED" || row.status === "CANCELLED",
  );
  const completionDays = completed
    .filter((row) => row.completedAt)
    .map((row) =>
      Math.max(
        0,
        (row.completedAt!.getTime() - row.createdAt.getTime()) / 86_400_000,
      ),
    );
  const partnerCounts = new Map<string, { name: string; count: number }>();
  const teamCounts = new Map<string, number>();
  for (const row of globalRows) {
    const current = partnerCounts.get(row.partnerId) ?? {
      name: row.partner.name,
      count: 0,
    };
    current.count += 1;
    partnerCounts.set(row.partnerId, current);
    if (row.status === "COMPLETED") {
      const responsibleId = row.assignedToId ?? row.ownerId;
      if (responsibleId)
        teamCounts.set(responsibleId, (teamCounts.get(responsibleId) ?? 0) + 1);
    }
  }
  const activityHistory = buildAllTimeActivityHistory(globalRows, now);

  return NextResponse.json({
    collaborations: rows,
    summary,
    recentActivity,
    recentNotes,
    reminders,
    tags,
    savedFilters,
    team: [...peopleById.values()],
    options: {
      statuses: COLLAB_STATUSES,
      priorities: COLLAB_PRIORITIES,
    },
    analytics: {
      total: globalRows.length,
      successRate: decided.length
        ? Math.round((completed.length / decided.length) * 100)
        : 0,
      averageCompletionDays: completionDays.length
        ? Math.round(
            completionDays.reduce((sum, days) => sum + days, 0) /
              completionDays.length,
          )
        : 0,
      wlCollected: globalRows.reduce(
        (sum, row) => sum + row.walletProgress.collected,
        0,
      ),
      wlHosted: globalRows
        .filter((row) => row.raffles.length > 0)
        .reduce((sum, row) => sum + row.whitelistAllocation, 0),
      pendingSubmissions: globalRows.filter((row) =>
        ["COLLECTING_WALLETS", "READY_FOR_SUBMISSION"].includes(row.status),
      ).length,
      topPartners: [...partnerCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      topTeamMembers: [...teamCounts.entries()]
        .map(([id, count]) => ({
          id,
          name: peopleById.get(id)?.name ?? id,
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      activityHistory,
    },
  });
});

export const POST = withAccess(async (req, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_CREATE,
  );
  const body = await req.json().catch(() => ({}));
  const projectName = text(body.projectName, 120);
  if (!projectName) {
    return NextResponse.json(
      { error: "Project name is required." },
      { status: 400 },
    );
  }
  const whitelistAllocation = Number(body.whitelistAllocation ?? 0);
  if (
    !Number.isInteger(whitelistAllocation) ||
    whitelistAllocation < 0 ||
    whitelistAllocation > 1_000_000
  ) {
    return NextResponse.json(
      { error: "Whitelist allocation must be a non-negative whole number." },
      { status: 400 },
    );
  }
  const status = isCollabStatus(body.status) ? body.status : "LEAD";
  const priority = isCollabPriority(body.priority) ? body.priority : "MEDIUM";
  const teamLeadId = text(body.ownerId, 40) || user.id;
  const assignmentIds = [teamLeadId, body.assignedToId, body.reviewerId].filter(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
  if (assignmentIds.length) {
    await requireOrgAccess(params.org, PERMISSIONS.COLLAB_ASSIGN);
    const activeMembers = await prisma.organizationMember.count({
      where: {
        organizationId: org.id,
        userId: { in: [...new Set(assignmentIds)] },
        status: "ACTIVE",
      },
    });
    const expected = new Set(assignmentIds).size;
    if (activeMembers !== expected) {
      return NextResponse.json(
        { error: "Every assignee must be an active team member." },
        { status: 400 },
      );
    }
  }

  const tags: string[] = Array.isArray(body.tags)
    ? [
        ...new Set<string>(
          body.tags
            .map((tag: unknown) => text(tag, 40))
            .filter((tag: string) => Boolean(tag)),
        ),
      ].slice(0, 12)
    : [];
  const hostAt = toOptionalDate(body.hostAt);
  const hostingDeadline = toOptionalDate(body.hostingDeadline);
  const walletSubmissionDeadline = toOptionalDate(
    body.walletSubmissionDeadline,
  );
  const collaborationDeadline = toOptionalDate(body.collaborationDeadline);
  const followUpAt = toOptionalDate(body.followUpAt);
  const primaryContactName = text(body.primaryContactName, 120);
  const note = text(body.notes, 10_000);

  const collaboration = await prisma.$transaction(async (tx) => {
    const partner = await tx.collaborationPartner.upsert({
      where: {
        organizationId_normalizedName: {
          organizationId: org.id,
          normalizedName: normalizeCollabName(projectName),
        },
      },
      create: {
        organizationId: org.id,
        name: projectName,
        normalizedName: normalizeCollabName(projectName),
        logoUrl: sanitizeHttpUrl(body.logoUrl),
        websiteUrl: sanitizeHttpUrl(body.websiteUrl),
        discordUrl: sanitizeHttpUrl(body.discordUrl),
        xUrl: sanitizeHttpUrl(body.xUrl),
        chain: text(body.chain, 40) || null,
        category: text(body.category, 80) || null,
        createdById: user.id,
      },
      update: {
        name: projectName,
        ...(body.logoUrl !== undefined
          ? { logoUrl: sanitizeHttpUrl(body.logoUrl) }
          : {}),
        ...(body.websiteUrl !== undefined
          ? { websiteUrl: sanitizeHttpUrl(body.websiteUrl) }
          : {}),
        ...(body.discordUrl !== undefined
          ? { discordUrl: sanitizeHttpUrl(body.discordUrl) }
          : {}),
        ...(body.xUrl !== undefined
          ? { xUrl: sanitizeHttpUrl(body.xUrl) }
          : {}),
        ...(body.chain !== undefined
          ? { chain: text(body.chain, 40) || null }
          : {}),
        ...(body.category !== undefined
          ? { category: text(body.category, 80) || null }
          : {}),
      },
    });

    const tagIds: string[] = [];
    for (const name of tags) {
      const tag = await tx.collaborationTag.upsert({
        where: {
          organizationId_normalizedName: {
            organizationId: org.id,
            normalizedName: normalizeCollabName(name),
          },
        },
        create: {
          organizationId: org.id,
          name,
          normalizedName: normalizeCollabName(name),
        },
        update: { name },
      });
      tagIds.push(tag.id);
    }

    const created = await tx.collaboration.create({
      data: {
        organizationId: org.id,
        partnerId: partner.id,
        projectName,
        status,
        priority,
        whitelistAllocation,
        requirements: text(body.requirements, 20_000) || null,
        primaryContactName: primaryContactName || null,
        discordUsername: text(body.discordUsername, 120) || null,
        telegram: text(body.telegram, 120) || null,
        email: text(body.email, 254) || null,
        ownerId: teamLeadId,
        assignedToId: text(body.assignedToId, 40) || null,
        reviewerId: text(body.reviewerId, 40) || null,
        hostAt,
        hostingDeadline,
        walletSubmissionDeadline,
        collaborationDeadline,
        followUpAt,
        noResponseDays: Math.max(
          1,
          Math.min(90, Number(body.noResponseDays) || 5),
        ),
        createdById: user.id,
        tags: tagIds.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
        activities: {
          create: {
            actorId: user.id,
            action: "COLLABORATION_CREATED",
            title: "Collaboration created",
            body: `${projectName} entered the pipeline as ${status.replaceAll("_", " ").toLowerCase()}.`,
          },
        },
        notes: note
          ? { create: { authorId: user.id, body: note, pinned: true } }
          : undefined,
      },
    });

    if (primaryContactName) {
      await tx.collaborationContact.create({
        data: {
          partnerId: partner.id,
          collaborationId: created.id,
          name: primaryContactName,
          role: text(body.contactRole, 80) || "Primary contact",
          discord: text(body.discordUsername, 120) || null,
          telegram: text(body.telegram, 120) || null,
          email: text(body.email, 254) || null,
          isPrimary: true,
          createdById: user.id,
        },
      });
    }

    const reminders: Prisma.CollaborationReminderCreateManyInput[] = [];
    const addReminder = (
      type: Prisma.CollaborationReminderCreateManyInput["type"],
      title: string,
      dueAt: Date | null,
    ) => {
      if (dueAt) {
        reminders.push({
          collaborationId: created.id,
          type,
          title,
          dueAt,
          automatic: true,
          createdById: user.id,
        });
      }
    };
    addReminder("HOSTING", "Hosting date", hostAt ?? hostingDeadline);
    addReminder(
      "WALLET_SUBMISSION",
      "Wallet submission deadline",
      walletSubmissionDeadline,
    );
    addReminder(
      "COLLABORATION_DEADLINE",
      "Collaboration deadline",
      collaborationDeadline,
    );
    addReminder("FOLLOW_UP", "Follow up with partner", followUpAt);
    if (reminders.length) {
      await tx.collaborationReminder.createMany({ data: reminders });
    }
    return created;
  });

  await logAudit(org.id, user.id, "COLLABORATION_CREATE", {
    targetType: "collaboration",
    targetId: collaboration.id,
    metadata: { projectName, status },
  });
  return NextResponse.json({ id: collaboration.id }, { status: 201 });
});
