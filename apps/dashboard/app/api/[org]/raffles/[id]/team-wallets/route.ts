import { NextResponse } from "next/server";
import { Prisma, type TeamWalletSelectionMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { communityRaffleWalletRows } from "@/lib/raffle-wallet-export";
import { ensureDefaultTeamWalletPool } from "@/lib/team-wallet-server";
import { selectTeamWallets } from "@/lib/team-wallet-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<TeamWalletSelectionMode>([
  "ROUND_ROBIN",
  "RANDOM",
  "PRIORITY",
]);

export const GET = withAccess(async (_request, { params }) => {
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.TEAM_WALLET_FILL,
  );
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const raffle = await prisma.raffle.findFirst({
    where: { id: raffleId, guildId: { in: guildIds } },
    select: {
      id: true,
      projectName: true,
      title: true,
      status: true,
      spots: true,
      walletChains: true,
    },
  });
  if (!raffle) {
    return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  }
  if (raffle.status !== "ENDED" && raffle.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Team wallets can only be filled after a raffle ends." },
      { status: 409 },
    );
  }
  const pool = await ensureDefaultTeamWalletPool(org.id);
  const [community, existingReservations] = await Promise.all([
    communityRaffleWalletRows(raffle.id, raffle.walletChains),
    prisma.teamWalletUsage.count({
      where: { raffleId: raffle.id, status: "RESERVED" },
    }),
  ]);
  const remaining = Math.max(
    0,
    raffle.spots - community.length - existingReservations,
  );
  const available = await prisma.teamWallet.count({
    where: {
      poolId: pool.id,
      status: "AVAILABLE",
      deletedAt: null,
      OR: [
        { chains: { hasSome: raffle.walletChains } },
        {
          chains: { isEmpty: true },
          chain: { in: raffle.walletChains },
        },
      ],
      ...(community.length
        ? { addressHash: { notIn: community.map((row) => row.addressHash) } }
        : {}),
    },
  });
  return NextResponse.json({
    raffle: {
      id: raffle.id,
      projectName: raffle.projectName,
      title: raffle.title,
      status: raffle.status,
    },
    selectionMode: pool.selectionMode,
    requiredWallets: raffle.spots,
    communityWallets: community.length,
    teamWalletsReserved: existingReservations,
    remainingWalletsNeeded: remaining,
    availableWallets: available,
  });
});

class SelectionConflict extends Error {}

export const POST = withAccess(async (request, { params }) => {
  const { org, user, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.TEAM_WALLET_FILL,
  );
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const requestedMode = String(
    body.selectionMode ?? "",
  ) as TeamWalletSelectionMode;
  if (requestedMode && !MODES.has(requestedMode)) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const pool = await ensureDefaultTeamWalletPool(org.id);

  let result:
    | {
        ok: true;
        selected: number;
        needed: number;
        community: number;
        mode: TeamWalletSelectionMode;
      }
    | { ok: false; status: number; error: string }
    | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(
        async (tx) => {
          const raffle = await tx.raffle.findFirst({
            where: { id: raffleId, guildId: { in: guildIds } },
            select: {
              id: true,
              projectName: true,
              status: true,
              spots: true,
              walletChains: true,
            },
          });
          if (!raffle) {
            return {
              ok: false as const,
              status: 404,
              error: "Raffle not found.",
            };
          }
          if (raffle.status !== "ENDED") {
            return {
              ok: false as const,
              status: 409,
              error: "Team wallets can only be filled after a raffle ends.",
            };
          }
          const currentPool = await tx.teamWalletPool.findUnique({
            where: { id: pool.id },
          });
          if (!currentPool) {
            return {
              ok: false as const,
              status: 404,
              error: "Team Wallet Pool not found.",
            };
          }
          const mode = requestedMode || currentPool.selectionMode;
          const community = await communityRaffleWalletRows(
            raffle.id,
            raffle.walletChains,
            tx,
          );
          const existingReservations = await tx.teamWalletUsage.count({
            where: { raffleId: raffle.id, status: "RESERVED" },
          });
          const needed = Math.max(
            0,
            raffle.spots - community.length - existingReservations,
          );
          if (needed === 0) {
            return {
              ok: true as const,
              selected: 0,
              needed,
              community: community.length,
              mode,
            };
          }
          const [candidates, members] = await Promise.all([
            tx.teamWallet.findMany({
              where: {
                poolId: currentPool.id,
                status: "AVAILABLE",
                deletedAt: null,
                OR: [
                  { chains: { hasSome: raffle.walletChains } },
                  {
                    chains: { isEmpty: true },
                    chain: { in: raffle.walletChains },
                  },
                ],
                ...(community.length
                  ? {
                      addressHash: {
                        notIn: community.map((row) => row.addressHash),
                      },
                    }
                  : {}),
              },
              select: {
                id: true,
                ownerId: true,
                addressHash: true,
                timesUsed: true,
                lastUsedAt: true,
                createdAt: true,
              },
            }),
            tx.teamWalletPoolMember.findMany({
              where: { poolId: currentPool.id },
              select: { userId: true, priority: true },
            }),
          ]);
          const selection = selectTeamWallets({
            candidates,
            members,
            needed,
            mode,
            lastSelectedOwnerId: currentPool.lastSelectedOwnerId,
          });
          if (selection.selected.length < needed) {
            return {
              ok: false as const,
              status: 409,
              error: `Only ${selection.selected.length} eligible team wallet${selection.selected.length === 1 ? " is" : "s are"} available; ${needed} needed.`,
            };
          }
          const now = new Date();
          const fill = await tx.raffleTeamWalletFill.create({
            data: {
              poolId: currentPool.id,
              raffleId: raffle.id,
              selectionMode: mode,
              requiredWallets: raffle.spots,
              communityWallets: community.length,
              selectedWallets: selection.selected.length,
              createdById: user.id,
            },
          });
          const selectedIds = selection.selected.map((wallet) => wallet.id);
          const reserved = await tx.teamWallet.updateMany({
            where: {
              id: { in: selectedIds },
              status: "AVAILABLE",
              deletedAt: null,
            },
            data: {
              status: "RESERVED",
              timesUsed: { increment: 1 },
              lastUsedAt: now,
            },
          });
          if (reserved.count !== selectedIds.length)
            throw new SelectionConflict();
          await tx.teamWalletUsage.createMany({
            data: selectedIds.map((walletId) => ({
              walletId,
              raffleId: raffle.id,
              fillId: fill.id,
              projectName: raffle.projectName,
              status: "RESERVED",
              reservedAt: now,
            })),
          });
          await tx.teamWalletPool.update({
            where: { id: currentPool.id },
            data: {
              selectionMode: mode,
              lastSelectedOwnerId: selection.lastSelectedOwnerId,
            },
          });
          return {
            ok: true as const,
            selected: selection.selected.length,
            needed,
            community: community.length,
            mode,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      const retryable =
        error instanceof SelectionConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034");
      if (!retryable || attempt === 2) throw error;
    }
  }
  if (!result) {
    return NextResponse.json(
      { error: "Wallet selection could not be completed." },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  await logAudit(org.id, user.id, "RAFFLE_TEAM_WALLETS_FILLED", {
    targetType: "raffle",
    targetId: String(raffleId),
    metadata: {
      selected: result.selected,
      community: result.community,
      selectionMode: result.mode,
    },
  });
  return NextResponse.json({
    ok: true,
    selected: result.selected,
    selectionMode: result.mode,
  });
});
