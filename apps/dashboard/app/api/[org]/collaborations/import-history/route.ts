import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  groupHistoricalRaffles,
  previewHistoricalRaffles,
  type HistoricalImportOptions,
} from "@/lib/collab-history";
import { sanitizeHttpUrl } from "@/lib/raffle-input";
import { selectConfiguredWallet } from "@/lib/winner-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const TAG_COLORS: Record<string, string> = {
  GTD: "#8B5CF6",
  FCFS: "#3B82F6",
  WL: "#10B981",
};

const earlier = (left: Date | null, right: Date) =>
  !left || right < left ? right : left;
const later = (left: Date | null, right: Date) =>
  !left || right > left ? right : left;

const raffleSelect = {
  id: true,
  projectName: true,
  title: true,
  status: true,
  spots: true,
  entryCount: true,
  createdAt: true,
  startAt: true,
  endAt: true,
  endedAt: true,
  createdById: true,
  externalUrl: true,
  walletChains: true,
  requirements: true,
  RaffleTask: {
    include: {
      task: { select: { title: true, type: true, config: true } },
    },
  },
} satisfies Prisma.RaffleSelect;

function importOptions(value: unknown): HistoricalImportOptions {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    includeEmpty: body.includeEmpty === true,
    includeCancelled: body.includeCancelled === true,
    includeTests: body.includeTests === true,
  };
}

async function loadHistoricalRaffles(guildIds: string[]) {
  const rows = await prisma.raffle.findMany({
    where: {
      guildId: { in: guildIds },
      status: { in: ["ENDED", "CANCELLED"] },
      collaborationLink: { is: null },
    },
    orderBy: { id: "asc" },
    select: raffleSelect,
  });
  return rows.map(({ RaffleTask, ...raffle }) => ({
    ...raffle,
    tasks: RaffleTask.map(({ task }) => task),
  }));
}

export const GET = withAccess(async (req, { params }) => {
  const { guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_CREATE,
  );
  const url = new URL(req.url);
  const options = importOptions({
    includeEmpty: url.searchParams.get("includeEmpty") === "1",
    includeCancelled: url.searchParams.get("includeCancelled") === "1",
    includeTests: url.searchParams.get("includeTests") === "1",
  });
  const raffles = await loadHistoricalRaffles(guildIds);
  return NextResponse.json(previewHistoricalRaffles(raffles, options));
});

export const POST = withAccess(async (req, { params }) => {
  const { org, user, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.COLLAB_CREATE,
  );

  const options = importOptions(await req.json().catch(() => ({})));
  const raffles = await loadHistoricalRaffles(guildIds);
  const preview = previewHistoricalRaffles(raffles, options);
  const groups = groupHistoricalRaffles(raffles, options);
  if (!groups.length) {
    return NextResponse.json({ collaborations: 0, raffles: 0, preview });
  }

  const activeTeam = await prisma.organizationMember.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  const activeTeamIds = new Set(activeTeam.map((member) => member.userId));
  const fallbackHostId = activeTeamIds.has(user.id)
    ? user.id
    : activeTeam[0]?.userId;
  if (!fallbackHostId) {
    return NextResponse.json(
      { error: "Add an active team member before importing raffle history." },
      { status: 409 },
    );
  }

  const raffleIds = groups.flatMap((group) => group.raffleIds);
  const winners = await prisma.winner.findMany({
    where: { raffleId: { in: raffleIds }, replaced: false },
    orderBy: [{ selectedAt: "asc" }, { position: "asc" }],
    include: {
      wallet: true,
      user: { include: { walletProfiles: true } },
    },
  });
  const winnersByRaffle = new Map<number, typeof winners>();
  for (const winner of winners) {
    const values = winnersByRaffle.get(winner.raffleId) ?? [];
    values.push(winner);
    winnersByRaffle.set(winner.raffleId, values);
  }
  const walletChainsByRaffle = new Map(
    raffles.map((raffle) => [raffle.id, raffle.walletChains] as const),
  );

  const tagIds = new Map<string, string>();
  for (const name of ["GTD", "FCFS", "WL"]) {
    const tag = await prisma.collaborationTag.upsert({
      where: {
        organizationId_normalizedName: {
          organizationId: org.id,
          normalizedName: name.toLowerCase(),
        },
      },
      create: {
        organizationId: org.id,
        name,
        normalizedName: name.toLowerCase(),
        color: TAG_COLORS[name],
      },
      update: { name, color: TAG_COLORS[name] },
    });
    tagIds.set(name, tag.id);
  }

  const importedIds: string[] = [];
  for (const group of groups) {
    const hostedById = activeTeamIds.has(group.hostedById)
      ? group.hostedById
      : fallbackHostId;
    const collaborationId = await prisma.$transaction(async (tx) => {
      const partnerMatch: Prisma.CollaborationPartnerWhereInput = {
        organizationId: org.id,
        OR: [
          { normalizedName: group.normalizedName },
          ...(group.xUrl ? [{ xUrl: group.xUrl }] : []),
        ],
      };
      let partner = await tx.collaborationPartner.findFirst({
        where: partnerMatch,
        orderBy: { updatedAt: "desc" },
      });
      if (!partner) {
        partner = await tx.collaborationPartner.create({
          data: {
            organizationId: org.id,
            name: group.projectName,
            normalizedName: group.normalizedName,
            websiteUrl: sanitizeHttpUrl(group.websiteUrl),
            xUrl: sanitizeHttpUrl(group.xUrl),
            createdById: user.id,
          },
        });
      } else {
        partner = await tx.collaborationPartner.update({
          where: { id: partner.id },
          data: {
            name: group.projectName,
            websiteUrl: partner.websiteUrl ?? sanitizeHttpUrl(group.websiteUrl),
            xUrl: partner.xUrl ?? sanitizeHttpUrl(group.xUrl),
          },
        });
      }

      const existing = await tx.collaboration.findFirst({
        where: {
          organizationId: org.id,
          partnerId: partner.id,
          activities: { some: { action: "RAFFLE_HISTORY_IMPORTED" } },
        },
        orderBy: { createdAt: "desc" },
      });
      const collaboration = existing
        ? await tx.collaboration.update({
            where: { id: existing.id },
            data: {
              projectName: group.projectName,
              status:
                existing.status === "COMPLETED" || group.status === "COMPLETED"
                  ? "COMPLETED"
                  : "CANCELLED",
              submissionStatus:
                existing.status === "COMPLETED" || group.status === "COMPLETED"
                  ? "ACCEPTED"
                  : existing.submissionStatus,
              whitelistAllocation:
                existing.whitelistAllocation + group.whitelistAllocation,
              requirements: [existing.requirements, group.requirements]
                .filter(Boolean)
                .join("\n"),
              hostAt: earlier(existing.hostAt, group.hostAt),
              completedAt:
                group.status === "COMPLETED"
                  ? later(existing.completedAt, group.completedAt)
                  : existing.completedAt,
              cancelledAt:
                group.status === "CANCELLED"
                  ? later(existing.cancelledAt, group.completedAt)
                  : existing.cancelledAt,
              lastActivityAt: later(existing.lastActivityAt, group.completedAt),
              ownerId: hostedById,
            },
          })
        : await tx.collaboration.create({
            data: {
              organizationId: org.id,
              partnerId: partner.id,
              projectName: group.projectName,
              status: group.status,
              priority: "MEDIUM",
              submissionStatus:
                group.status === "COMPLETED" ? "ACCEPTED" : "NOT_STARTED",
              whitelistAllocation: group.whitelistAllocation,
              requirements: group.requirements,
              ownerId: hostedById,
              hostAt: group.hostAt,
              completedAt:
                group.status === "COMPLETED" ? group.completedAt : null,
              cancelledAt:
                group.status === "CANCELLED" ? group.completedAt : null,
              lastActivityAt: group.completedAt,
              createdById: user.id,
              createdAt: group.hostAt,
            },
          });

      await tx.collaborationRaffle.createMany({
        data: group.raffleIds.map((raffleId) => ({
          collaborationId: collaboration.id,
          raffleId,
          attachedById: user.id,
        })),
        skipDuplicates: true,
      });
      await tx.collaborationTagAssignment.createMany({
        data: group.variants.map((variant) => ({
          collaborationId: collaboration.id,
          tagId: tagIds.get(variant)!,
        })),
        skipDuplicates: true,
      });

      const winnerRows = new Map<
        string,
        Prisma.CollaborationWalletCreateManyInput
      >();
      for (const raffleId of group.raffleIds) {
        for (const winner of winnersByRaffle.get(raffleId) ?? []) {
          const source = selectConfiguredWallet(
            winner.wallet,
            winner.user.walletProfiles,
            walletChainsByRaffle.get(raffleId) ?? [],
          );
          const current = winnerRows.get(winner.userId);
          if (!current || (!current.chain && source?.chain)) {
            winnerRows.set(winner.userId, {
              collaborationId: collaboration.id,
              userId: winner.userId,
              winnerId: winner.id,
              chain: source?.chain ?? null,
              status: source ? "COLLECTED" : "WAITING",
            });
          }
        }
      }
      if (winnerRows.size) {
        await tx.collaborationWallet.createMany({
          data: [...winnerRows.values()],
          skipDuplicates: true,
        });
      }
      await tx.collaborationActivity.create({
        data: {
          collaborationId: collaboration.id,
          actorId: user.id,
          action: "RAFFLE_HISTORY_IMPORTED",
          title: "Raffle history imported",
          body: `${group.raffleIds.length} historical raffle${group.raffleIds.length === 1 ? "" : "s"} grouped by project name and shared X tasks.`,
          metadata: {
            raffleIds: group.raffleIds,
            variants: group.variants,
          },
          createdAt: group.completedAt,
        },
      });
      return collaboration.id;
    });
    importedIds.push(collaborationId);
  }

  await logAudit(org.id, user.id, "COLLABORATION_HISTORY_IMPORT", {
    targetType: "collaboration",
    metadata: {
      collaborations: new Set(importedIds).size,
      raffles: raffleIds.length,
      options: {
        includeEmpty: Boolean(options.includeEmpty),
        includeCancelled: Boolean(options.includeCancelled),
        includeTests: Boolean(options.includeTests),
      },
    },
  });

  return NextResponse.json({
    collaborations: new Set(importedIds).size,
    raffles: raffleIds.length,
    preview,
  });
});
