import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  isCollabPriority,
  isCollabStatus,
  normalizeCollabName,
  toOptionalDate,
} from "@/lib/collab-shared";
import { syncCollaborationState } from "@/lib/collab";
import { sanitizeHttpUrl } from "@/lib/raffle-input";
import { sanitizeRichText } from "@/lib/rich-text";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const include = {
  partner: true,
  tags: { include: { tag: true } },
  raffles: {
    orderBy: { createdAt: "desc" as const },
    include: {
      raffle: {
        include: {
          proof: {
            select: {
              id: true,
              messageLink: true,
              generatedAt: true,
              artifactsStoredAt: true,
            },
          },
          _count: { select: { winners: true } },
        },
      },
    },
  },
  wallets: {
    orderBy: { createdAt: "asc" as const },
    include: {
      user: { select: { username: true, globalName: true, avatarUrl: true } },
    },
  },
  contacts: {
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
  notes: {
    orderBy: [{ pinned: "desc" as const }, { updatedAt: "desc" as const }],
  },
  comments: { orderBy: { createdAt: "desc" as const }, take: 100 },
  attachments: { orderBy: { createdAt: "desc" as const } },
  activities: { orderBy: { createdAt: "desc" as const }, take: 150 },
  reminders: { orderBy: { dueAt: "asc" as const } },
} satisfies Prisma.CollaborationInclude;

export const GET = withAccess(async (_req, { params }) => {
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_VIEW,
  );
  await syncCollaborationState(params.id, org.id);
  const collaboration = await prisma.collaboration.findFirst({
    where: { id: params.id, organizationId: org.id },
    include,
  });
  if (!collaboration) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }

  const actorIds = new Set<string>();
  [
    collaboration.createdById,
    collaboration.ownerId,
    collaboration.assignedToId,
    collaboration.reviewerId,
    ...collaboration.notes.map((note) => note.authorId),
    ...collaboration.comments.map((comment) => comment.authorId),
    ...collaboration.activities.map((activity) => activity.actorId),
    ...collaboration.attachments.map((attachment) => attachment.uploadedById),
  ].forEach((id) => {
    if (id) actorIds.add(id);
  });
  const people = actorIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...actorIds] } },
        select: { id: true, username: true, globalName: true, avatarUrl: true },
      })
    : [];
  const [members, owner, availableRaffles] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: org.id, status: "ACTIVE" },
      include: { user: true, role: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: org.ownerId },
      select: { id: true, username: true, globalName: true, avatarUrl: true },
    }),
    prisma.raffle.findMany({
      where: {
        guildId: { in: guildIds },
        collaborationLink: null,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        projectName: true,
        title: true,
        status: true,
        spots: true,
        endAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const team = new Map<
    string,
    { id: string; name: string; avatarUrl: string | null; role: string }
  >();
  if (owner) {
    team.set(owner.id, {
      id: owner.id,
      name: owner.globalName ?? owner.username,
      avatarUrl: owner.avatarUrl,
      role: "Owner",
    });
  }
  for (const member of members) {
    team.set(member.userId, {
      id: member.userId,
      name: member.user.globalName ?? member.user.username,
      avatarUrl: member.user.avatarUrl,
      role: member.role.name,
    });
  }

  const collected = collaboration.wallets.filter((wallet) =>
    ["COLLECTED", "SUBMITTED"].includes(wallet.status),
  ).length;
  const submitted = collaboration.wallets.filter(
    (wallet) => wallet.status === "SUBMITTED",
  ).length;
  const rejected = collaboration.wallets.filter(
    (wallet) => wallet.status === "REJECTED",
  ).length;
  const total = Math.max(
    collaboration.whitelistAllocation,
    collaboration.wallets.length,
  );

  return NextResponse.json({
    collaboration: {
      ...collaboration,
      notes: collaboration.notes.map((note) => ({
        ...note,
        body: sanitizeRichText(note.body),
      })),
      attachments: collaboration.attachments.map(
        ({ url: _url, ...file }) => file,
      ),
    },
    availableRaffles,
    team: [...team.values()],
    people: people.map((person) => ({
      id: person.id,
      name: person.globalName ?? person.username,
      avatarUrl: person.avatarUrl,
    })),
    walletProgress: {
      total,
      collected,
      submitted,
      rejected,
      remaining: Math.max(0, total - collected - rejected),
      percent: total ? Math.min(100, Math.round((collected / total) * 100)) : 0,
    },
  });
});

export const PATCH = withAccess(async (req, { params }) => {
  const access = await requireOrgAccess(params.org, PERMISSIONS.COLLAB_EDIT);
  const existing = await prisma.collaboration.findFirst({
    where: { id: params.id, organizationId: access.org.id },
    include: { partner: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const assignmentFields = ["ownerId", "assignedToId", "reviewerId"];
  if (assignmentFields.some((field) => field in body)) {
    await requireOrgAccess(params.org, PERMISSIONS.COLLAB_ASSIGN);
    const ids = assignmentFields
      .map((field) => text(body[field], 40))
      .filter(Boolean)
      .filter((id) => id !== access.org.ownerId);
    if (ids.length) {
      const found = await prisma.organizationMember.count({
        where: {
          organizationId: access.org.id,
          userId: { in: [...new Set(ids)] },
          status: "ACTIVE",
        },
      });
      if (found !== new Set(ids).size) {
        return NextResponse.json(
          { error: "Every assignee must be an active team member." },
          { status: 400 },
        );
      }
    }
  }

  const data: Prisma.CollaborationUncheckedUpdateInput = {};
  if ("projectName" in body) {
    const projectName = text(body.projectName, 120);
    if (!projectName) {
      return NextResponse.json(
        { error: "Project name is required." },
        { status: 400 },
      );
    }
    data.projectName = projectName;
  }
  if (isCollabStatus(body.status)) {
    data.status = body.status;
    data.completedAt =
      body.status === "COMPLETED" ? new Date() : existing.completedAt;
    data.cancelledAt =
      body.status === "CANCELLED" ? new Date() : existing.cancelledAt;
    if (body.status === "SUBMITTED") data.submissionStatus = "SUBMITTED";
    if (body.status === "COMPLETED") data.submissionStatus = "ACCEPTED";
  }
  if (isCollabPriority(body.priority)) data.priority = body.priority;
  if ("whitelistAllocation" in body) {
    const allocation = Number(body.whitelistAllocation);
    if (
      !Number.isInteger(allocation) ||
      allocation < 0 ||
      allocation > 1_000_000
    ) {
      return NextResponse.json(
        { error: "Whitelist allocation must be a non-negative whole number." },
        { status: 400 },
      );
    }
    data.whitelistAllocation = allocation;
  }
  const scalarFields = [
    ["requirements", 20_000],
    ["primaryContactName", 120],
    ["discordUsername", 120],
    ["telegram", 120],
    ["email", 254],
    ["ownerId", 40],
    ["assignedToId", 40],
    ["reviewerId", 40],
  ] as const;
  for (const [field, max] of scalarFields) {
    if (field in body) data[field] = text(body[field], max) || null;
  }
  const dateFields = [
    "hostAt",
    "hostingDeadline",
    "walletSubmissionDeadline",
    "collaborationDeadline",
    "followUpAt",
  ] as const;
  for (const field of dateFields) {
    if (field in body) data[field] = toOptionalDate(body[field]);
  }
  if ("noResponseDays" in body) {
    data.noResponseDays = Math.max(
      1,
      Math.min(90, Number(body.noResponseDays) || 5),
    );
  }
  data.lastActivityAt = new Date();

  const partnerData: Prisma.CollaborationPartnerUncheckedUpdateInput = {};
  if ("projectName" in body) {
    const name = text(body.projectName, 120);
    const normalizedName = normalizeCollabName(name);
    if (normalizedName !== existing.partner.normalizedName) {
      const duplicate = await prisma.collaborationPartner.findFirst({
        where: {
          organizationId: access.org.id,
          normalizedName,
          id: { not: existing.partnerId },
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "A partner with that project name already exists." },
          { status: 409 },
        );
      }
    }
    partnerData.name = name;
    partnerData.normalizedName = normalizedName;
  }
  const partnerUrls = ["logoUrl", "websiteUrl", "discordUrl", "xUrl"] as const;
  for (const field of partnerUrls) {
    if (field in body) partnerData[field] = sanitizeHttpUrl(body[field]);
  }
  if ("chain" in body) partnerData.chain = text(body.chain, 40) || null;
  if ("category" in body)
    partnerData.category = text(body.category, 80) || null;
  if ("privateNotes" in body) {
    partnerData.privateNotes = text(body.privateNotes, 20_000) || null;
  }
  if ("trustRating" in body) {
    const rating = Number(body.trustRating);
    partnerData.trustRating = Number.isInteger(rating)
      ? Math.max(1, Math.min(5, rating))
      : null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(partnerData).length) {
      await tx.collaborationPartner.update({
        where: { id: existing.partnerId },
        data: partnerData,
      });
    }
    if (Array.isArray(body.tags)) {
      const names: string[] = [
        ...new Set<string>(
          body.tags
            .map((value: unknown) => text(value, 40))
            .filter((value: string) => Boolean(value)),
        ),
      ].slice(0, 12);
      const tagIds: string[] = [];
      for (const name of names) {
        const tag = await tx.collaborationTag.upsert({
          where: {
            organizationId_normalizedName: {
              organizationId: access.org.id,
              normalizedName: normalizeCollabName(name),
            },
          },
          create: {
            organizationId: access.org.id,
            name,
            normalizedName: normalizeCollabName(name),
          },
          update: { name },
        });
        tagIds.push(tag.id);
      }
      await tx.collaborationTagAssignment.deleteMany({
        where: { collaborationId: existing.id },
      });
      if (tagIds.length) {
        await tx.collaborationTagAssignment.createMany({
          data: tagIds.map((tagId) => ({
            collaborationId: existing.id,
            tagId,
          })),
        });
      }
    }
    const saved = await tx.collaboration.update({
      where: { id: existing.id },
      data,
    });
    if ("hostAt" in body || "hostingDeadline" in body) {
      await tx.collaborationReminder.deleteMany({
        where: {
          collaborationId: existing.id,
          type: "HOSTING",
          automatic: true,
          completedAt: null,
        },
      });
      const dueAt =
        toOptionalDate(body.hostAt) ?? toOptionalDate(body.hostingDeadline);
      if (dueAt) {
        await tx.collaborationReminder.create({
          data: {
            collaborationId: existing.id,
            type: "HOSTING",
            title: toOptionalDate(body.hostAt)
              ? "Hosting date"
              : "Hosting deadline",
            dueAt,
            automatic: true,
            createdById: access.user.id,
          },
        });
      }
    }
    const reminderFields = [
      [
        "walletSubmissionDeadline",
        "WALLET_SUBMISSION",
        "Wallet submission deadline",
      ],
      [
        "collaborationDeadline",
        "COLLABORATION_DEADLINE",
        "Collaboration deadline",
      ],
      ["followUpAt", "FOLLOW_UP", "Follow up with partner"],
    ] as const;
    for (const [field, type, title] of reminderFields) {
      if (!(field in body)) continue;
      await tx.collaborationReminder.deleteMany({
        where: {
          collaborationId: existing.id,
          type,
          automatic: true,
          completedAt: null,
        },
      });
      const dueAt = toOptionalDate(body[field]);
      if (dueAt) {
        await tx.collaborationReminder.create({
          data: {
            collaborationId: existing.id,
            type,
            title,
            dueAt,
            automatic: true,
            createdById: access.user.id,
          },
        });
      }
    }
    const statusChanged = data.status && data.status !== existing.status;
    await tx.collaborationActivity.create({
      data: {
        collaborationId: existing.id,
        actorId: access.user.id,
        action: statusChanged ? "STATUS_CHANGED" : "COLLABORATION_UPDATED",
        title: statusChanged
          ? `Status changed to ${String(data.status).replaceAll("_", " ").toLowerCase()}`
          : "Collaboration updated",
        metadata: statusChanged
          ? { from: existing.status, to: data.status }
          : undefined,
      },
    });
    return saved;
  });

  await logAudit(access.org.id, access.user.id, "COLLABORATION_UPDATE", {
    targetType: "collaboration",
    targetId: existing.id,
    metadata: { status: updated.status },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAccess(async (_req, { params }) => {
  const { org, user } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_ARCHIVE,
  );
  const result = await prisma.collaboration.updateMany({
    where: { id: params.id, organizationId: org.id, archivedAt: null },
    data: { archivedAt: new Date(), lastActivityAt: new Date() },
  });
  if (!result.count) {
    return NextResponse.json(
      { error: "Collaboration not found." },
      { status: 404 },
    );
  }
  await logAudit(org.id, user.id, "COLLABORATION_ARCHIVE", {
    targetType: "collaboration",
    targetId: params.id,
  });
  return NextResponse.json({ ok: true });
});
