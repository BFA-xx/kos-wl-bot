import { NextResponse } from "next/server";
import { Prisma, type TeamWalletSelectionMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { communityRaffleWalletRows } from "@/lib/raffle-wallet-export";
import {
  eligibleTeamWallets,
  ensureDefaultTeamWalletPool,
} from "@/lib/team-wallet-server";
import { selectTeamWallets } from "@/lib/team-wallet-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<TeamWalletSelectionMode>([
  "ROUND_ROBIN",
  "RANDOM",
  "PRIORITY",
]);

function requestedSelectionMode(value: unknown) {
  const mode = String(value ?? "") as TeamWalletSelectionMode;
  return mode && MODES.has(mode) ? mode : null;
}

export const GET = withAccess(async (request, { params }) => {
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.TEAM_WALLET_FILL,
  );
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const url = new URL(request.url);
  const modeParam = url.searchParams.get("selectionMode");
  const countParam = url.searchParams.get("count");
  const requestedMode = modeParam ? requestedSelectionMode(modeParam) : null;
  if (modeParam && !requestedMode) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const requestedCount = countParam === null ? null : Number(countParam);
  if (
    requestedCount !== null &&
    (!Number.isInteger(requestedCount) || requestedCount < 1)
  ) {
    return NextResponse.json(
      { error: "Team wallet count must be a positive whole number." },
      { status: 400 },
    );
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
  const [community, existingReservations, members] = await Promise.all([
    communityRaffleWalletRows(raffle.id, raffle.walletChains),
    prisma.teamWalletUsage.count({
      where: { raffleId: raffle.id, status: "RESERVED" },
    }),
    prisma.teamWalletPoolMember.findMany({
      where: { poolId: pool.id },
      select: { userId: true, priority: true },
    }),
  ]);
  const remaining = Math.max(
    0,
    raffle.spots - community.length - existingReservations,
  );
  const candidates = await eligibleTeamWallets({
    poolId: pool.id,
    raffleId: raffle.id,
    walletChains: raffle.walletChains,
    communityAddressHashes: community.map((row) => row.addressHash),
  });
  const maxSelectable = Math.min(remaining, candidates.length);
  if (requestedCount !== null && requestedCount > maxSelectable) {
    return NextResponse.json(
      {
        error: `Only ${maxSelectable} team wallet${maxSelectable === 1 ? " is" : "s are"} selectable right now.`,
      },
      { status: 409 },
    );
  }
  const selectionMode = requestedMode ?? pool.selectionMode;
  const selectedCount = requestedCount ?? maxSelectable;
  const selection = selectTeamWallets({
    candidates,
    members,
    needed: selectedCount,
    mode: selectionMode,
    lastSelectedOwnerId: pool.lastSelectedOwnerId,
  });

  return NextResponse.json({
    raffle: {
      id: raffle.id,
      projectName: raffle.projectName,
      title: raffle.title,
      status: raffle.status,
    },
    selectionMode,
    requiredWallets: raffle.spots,
    communityWallets: community.length,
    teamWalletsReserved: existingReservations,
    remainingWalletsNeeded: remaining,
    availableWallets: candidates.length,
    maxSelectable,
    selectedCount: selection.selected.length,
    selectedWallets: selection.selected.map((wallet) => ({
      id: wallet.id,
      address: wallet.address,
      ownerId: wallet.ownerId,
      ownerName: wallet.ownerName,
      chain: wallet.chain,
      version: wallet.updatedAt.toISOString(),
    })),
  });
});

class SelectionConflict extends Error {}

interface RequestedWallet {
  id: string;
  version: string;
}

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
  const requestedMode = requestedSelectionMode(body.selectionMode);
  if (!requestedMode) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const count = Number(body.count);
  const requestedWallets: RequestedWallet[] = Array.isArray(body.wallets)
    ? body.wallets.map((wallet: unknown) => {
        const value = wallet as Record<string, unknown>;
        return {
          id: String(value.id ?? ""),
          version: String(value.version ?? ""),
        };
      })
    : [];
  const uniqueIds = new Set(requestedWallets.map((wallet) => wallet.id));
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    requestedWallets.length !== count ||
    uniqueIds.size !== count ||
    requestedWallets.some((wallet) => !wallet.id || !wallet.version)
  ) {
    return NextResponse.json(
      { error: "Preview the requested number of wallets before confirming." },
      { status: 400 },
    );
  }
  const pool = await ensureDefaultTeamWalletPool(org.id);

  let result:
    | {
        ok: true;
        selected: number;
        community: number;
        remaining: number;
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

          // Serialize confirmations that contain any of the same wallets. The
          // version check below rejects a concurrently-used preview.
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "team_wallets" WHERE "id" IN (${Prisma.join(
              requestedWallets.map((wallet) => wallet.id),
            )}) ORDER BY "id" FOR UPDATE`,
          );

          const community = await communityRaffleWalletRows(
            raffle.id,
            raffle.walletChains,
            tx,
          );
          const existingReservations = await tx.teamWalletUsage.count({
            where: { raffleId: raffle.id, status: "RESERVED" },
          });
          const remaining = Math.max(
            0,
            raffle.spots - community.length - existingReservations,
          );
          if (count > remaining) {
            return {
              ok: false as const,
              status: 409,
              error: `Only ${remaining} raffle slot${remaining === 1 ? " remains" : "s remain"}. Refresh the preview.`,
            };
          }
          const candidates = await eligibleTeamWallets({
            poolId: currentPool.id,
            raffleId: raffle.id,
            walletChains: raffle.walletChains,
            communityAddressHashes: community.map((row) => row.addressHash),
            db: tx,
          });
          const byId = new Map(candidates.map((wallet) => [wallet.id, wallet]));
          const selection = requestedWallets.map((requested) => ({
            requested,
            wallet: byId.get(requested.id),
          }));
          if (
            selection.some(
              ({ requested, wallet }) =>
                !wallet || wallet.updatedAt.toISOString() !== requested.version,
            )
          ) {
            return {
              ok: false as const,
              status: 409,
              error:
                "Wallet availability changed after this preview. Regenerate the selection and confirm again.",
            };
          }

          const now = new Date();
          const fill = await tx.raffleTeamWalletFill.create({
            data: {
              poolId: currentPool.id,
              raffleId: raffle.id,
              selectionMode: requestedMode,
              requiredWallets: raffle.spots,
              communityWallets: community.length,
              selectedWallets: count,
              createdById: user.id,
            },
          });
          const selected = selection.map(({ wallet }) => wallet!);
          const selectedIds = selected.map((wallet) => wallet.id);
          const reserved = await tx.teamWallet.updateMany({
            where: {
              id: { in: selectedIds },
              status: { not: "DISABLED" },
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
              selectionMode: requestedMode,
              lastSelectedOwnerId: selected.at(-1)?.ownerId ?? null,
            },
          });
          return {
            ok: true as const,
            selected: selected.length,
            community: community.length,
            remaining: remaining - selected.length,
            mode: requestedMode,
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
      if (!retryable) throw error;
      if (attempt === 2) {
        result = {
          ok: false,
          status: 409,
          error:
            "Wallet availability changed while reserving. Regenerate the selection and try again.",
        };
      }
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
      remaining: result.remaining,
      selectionMode: result.mode,
    },
  });
  return NextResponse.json({
    ok: true,
    selected: result.selected,
    remaining: result.remaining,
    selectionMode: result.mode,
  });
});
