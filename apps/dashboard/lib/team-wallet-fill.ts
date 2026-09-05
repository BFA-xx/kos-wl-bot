import { Prisma, type TeamWalletSelectionMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { communityRaffleWalletRows } from "@/lib/raffle-wallet-export";
import {
  eligibleTeamWallets,
  ensureDefaultTeamWalletPool,
} from "@/lib/team-wallet-server";
import { selectTeamWallets } from "@/lib/team-wallet-pool";

/**
 * Reserving team-pool wallets against a raffle.
 *
 * Two front ends reach this: the dashboard modal, which previews an exact set
 * of wallets and then confirms those same ones, and the Discord flow, which
 * cannot carry a wallet list through a 100-character interaction id and so
 * re-selects inside the reserving transaction. Both share the transaction
 * below rather than keeping two copies of a Serializable reservation.
 */

export class TeamWalletFillError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "TeamWalletFillError";
  }
}

/** Thrown to trigger a retry when a wallet was taken mid-transaction. */
class SelectionConflict extends Error {}

export interface ExpectedWallet {
  id: string;
  version: string;
}

export interface FillIdentity {
  organizationId: string;
  guildIds: string[];
  raffleId: number;
}

export interface PreviewedWallet {
  id: string;
  address: string;
  ownerId: string;
  ownerName: string;
  chain: string;
  version: string;
}

export interface FillPreview {
  raffle: { id: number; projectName: string; title: string; status: string };
  selectionMode: TeamWalletSelectionMode;
  requiredWallets: number;
  communityWallets: number;
  teamWalletsReserved: number;
  remainingWalletsNeeded: number;
  availableWallets: number;
  maxSelectable: number;
  selectedCount: number;
  selectedWallets: PreviewedWallet[];
}

export async function previewTeamWalletFill(
  identity: FillIdentity,
  requestedCount: number | null,
  requestedMode: TeamWalletSelectionMode | null,
): Promise<FillPreview> {
  const raffle = await prisma.raffle.findFirst({
    where: { id: identity.raffleId, guildId: { in: identity.guildIds } },
    select: {
      id: true,
      projectName: true,
      title: true,
      status: true,
      spots: true,
      walletChains: true,
    },
  });
  if (!raffle) throw new TeamWalletFillError(404, "Raffle not found.");
  if (raffle.status !== "ENDED" && raffle.status !== "CANCELLED") {
    throw new TeamWalletFillError(
      409,
      "Team wallets can only be filled after a raffle ends.",
    );
  }

  const pool = await ensureDefaultTeamWalletPool(identity.organizationId);
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
  // Spots are held back for the team on purpose, so the pool's own
  // availability is the only hard cap — see the route's GET handler.
  const maxSelectable = candidates.length;
  if (requestedCount !== null && requestedCount > maxSelectable) {
    throw new TeamWalletFillError(
      409,
      `Only ${maxSelectable} team wallet${maxSelectable === 1 ? " is" : "s are"} selectable right now.`,
    );
  }
  const selectionMode = requestedMode ?? pool.selectionMode;
  const selectedCount =
    requestedCount ?? Math.min(remaining > 0 ? remaining : 1, maxSelectable);
  const selection = selectTeamWallets({
    candidates,
    members,
    needed: selectedCount,
    mode: selectionMode,
    lastSelectedOwnerId: pool.lastSelectedOwnerId,
  });

  return {
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
  };
}

export interface CommitResult {
  selected: number;
  community: number;
  remaining: number;
  mode: TeamWalletSelectionMode;
  wallets: { address: string; ownerName: string; chain: string }[];
}

export interface CommitOptions extends FillIdentity {
  count: number;
  selectionMode: TeamWalletSelectionMode;
  userId: string;
  /**
   * The exact wallets a preview showed. The dashboard sends these so a
   * confirmation cannot silently reserve something the operator never saw;
   * Discord omits them and the set is chosen inside the transaction instead.
   */
  expectedWallets?: ExpectedWallet[];
}

export async function commitTeamWalletFill(
  options: CommitOptions,
): Promise<CommitResult> {
  const pool = await ensureDefaultTeamWalletPool(options.organizationId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const raffle = await tx.raffle.findFirst({
            where: { id: options.raffleId, guildId: { in: options.guildIds } },
            select: {
              id: true,
              projectName: true,
              status: true,
              spots: true,
              walletChains: true,
            },
          });
          if (!raffle) throw new TeamWalletFillError(404, "Raffle not found.");
          if (raffle.status !== "ENDED") {
            throw new TeamWalletFillError(
              409,
              "Team wallets can only be filled after a raffle ends.",
            );
          }
          const currentPool = await tx.teamWalletPool.findUnique({
            where: { id: pool.id },
          });
          if (!currentPool) {
            throw new TeamWalletFillError(404, "Team Wallet Pool not found.");
          }

          if (options.expectedWallets?.length) {
            // Serialize confirmations that contain any of the same wallets.
            // The version check below rejects a concurrently-used preview.
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "team_wallets" WHERE "id" IN (${Prisma.join(
                options.expectedWallets.map((wallet) => wallet.id),
              )}) ORDER BY "id" FOR UPDATE`,
            );
          }

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
          const candidates = await eligibleTeamWallets({
            poolId: currentPool.id,
            raffleId: raffle.id,
            walletChains: raffle.walletChains,
            communityAddressHashes: community.map((row) => row.addressHash),
            db: tx,
          });

          let selected: typeof candidates;
          if (options.expectedWallets?.length) {
            const byId = new Map(
              candidates.map((wallet) => [wallet.id, wallet]),
            );
            const paired = options.expectedWallets.map((requested) => ({
              requested,
              wallet: byId.get(requested.id),
            }));
            if (
              paired.some(
                ({ requested, wallet }) =>
                  !wallet ||
                  wallet.updatedAt.toISOString() !== requested.version,
              )
            ) {
              throw new TeamWalletFillError(
                409,
                "Wallet availability changed after this preview. Regenerate the selection and confirm again.",
              );
            }
            selected = paired.map(({ wallet }) => wallet!);
          } else {
            // Discord: no preview travels with the confirmation, so the set is
            // chosen here against live availability. Nothing stale can be
            // reserved, but the wallets are reported back so the operator sees
            // exactly what was taken.
            if (options.count > candidates.length) {
              throw new TeamWalletFillError(
                409,
                `Only ${candidates.length} team wallet${candidates.length === 1 ? " is" : "s are"} available now. Re-open the fill.`,
              );
            }
            const members = await tx.teamWalletPoolMember.findMany({
              where: { poolId: currentPool.id },
              select: { userId: true, priority: true },
            });
            selected = selectTeamWallets({
              candidates,
              members,
              needed: options.count,
              mode: options.selectionMode,
              lastSelectedOwnerId: currentPool.lastSelectedOwnerId,
            }).selected;
            if (selected.length !== options.count) {
              throw new TeamWalletFillError(
                409,
                "Could not select that many wallets. Re-open the fill.",
              );
            }
          }

          const now = new Date();
          const fill = await tx.raffleTeamWalletFill.create({
            data: {
              poolId: currentPool.id,
              raffleId: raffle.id,
              selectionMode: options.selectionMode,
              requiredWallets: raffle.spots,
              communityWallets: community.length,
              selectedWallets: selected.length,
              createdById: options.userId,
            },
          });
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
          if (reserved.count !== selectedIds.length) {
            throw new SelectionConflict();
          }
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
              selectionMode: options.selectionMode,
              lastSelectedOwnerId: selected.at(-1)?.ownerId ?? null,
            },
          });
          return {
            selected: selected.length,
            community: community.length,
            remaining: Math.max(0, remaining - selected.length),
            mode: options.selectionMode,
            wallets: selected.map((wallet) => ({
              address: wallet.address,
              ownerName: wallet.ownerName,
              chain: wallet.chain,
            })),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable =
        error instanceof SelectionConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034");
      if (!retryable) throw error;
    }
  }
  throw new TeamWalletFillError(
    409,
    "Wallet availability changed while reserving. Regenerate the selection and try again.",
  );
}
