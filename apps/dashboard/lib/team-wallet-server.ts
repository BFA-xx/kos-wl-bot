import type { Prisma, RaffleStatus, WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/lib/access";
import { decryptSecret } from "@/lib/crypto";
import {
  teamWalletAddressHash,
  teamWalletChains,
  type TeamWalletCandidate,
} from "@/lib/team-wallet-pool";
import { validateWalletAddress } from "@/lib/wallet-validation";

export const ACTIVE_RAFFLE_STATUSES = [
  "DRAFT",
  "UPCOMING",
  "LIVE",
] as const satisfies readonly RaffleStatus[];

export interface EligibleTeamWallet extends TeamWalletCandidate {
  address: string;
  chain: WalletChain;
  ownerName: string;
  updatedAt: Date;
}

type TeamWalletEligibilityDb = Pick<Prisma.TransactionClient, "teamWallet">;

/**
 * The single raffle-specific availability source used by preview and reserve.
 * Wallet-level RESERVED is historical for fills on ended raffles; only an
 * active raffle reservation blocks reuse. Invalid/decrypt-failed rows are
 * excluded here instead of inflating the UI count.
 */
export async function eligibleTeamWallets({
  poolId,
  raffleId,
  walletChains,
  communityAddressHashes,
  db = prisma,
}: {
  poolId: string;
  raffleId: number;
  walletChains: readonly WalletChain[];
  communityAddressHashes: readonly string[];
  db?: TeamWalletEligibilityDb;
}): Promise<EligibleTeamWallet[]> {
  const wallets = await db.teamWallet.findMany({
    where: {
      poolId,
      deletedAt: null,
      status: { not: "DISABLED" },
      OR: [
        { chains: { hasSome: [...walletChains] } },
        {
          chains: { isEmpty: true },
          chain: { in: [...walletChains] },
        },
      ],
      usages: {
        none: {
          OR: [
            // A wallet may never be inserted into the same raffle twice,
            // including after a cancellation/release.
            { raffleId },
            {
              status: "RESERVED",
              raffle: { status: { in: [...ACTIVE_RAFFLE_STATUSES] } },
            },
          ],
        },
      },
    },
    select: {
      id: true,
      ownerId: true,
      chain: true,
      chains: true,
      address: true,
      addressHash: true,
      timesUsed: true,
      lastUsedAt: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { username: true, globalName: true } },
    },
  });
  const community = new Set(communityAddressHashes);
  const eligible: EligibleTeamWallet[] = [];
  for (const wallet of wallets) {
    const chain = walletChains.find((candidate) =>
      teamWalletChains(wallet).includes(candidate),
    );
    if (!chain) continue;
    const validation = validateWalletAddress(
      chain,
      decryptSecret(wallet.address),
    );
    if (!validation.ok) continue;
    const addressHash = teamWalletAddressHash(chain, validation.normalized);
    if (addressHash !== wallet.addressHash || community.has(addressHash))
      continue;
    eligible.push({
      id: wallet.id,
      ownerId: wallet.ownerId,
      addressHash,
      timesUsed: wallet.timesUsed,
      lastUsedAt: wallet.lastUsedAt,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      address: validation.normalized,
      chain,
      ownerName: wallet.owner.globalName ?? wallet.owner.username,
    });
  }
  return eligible;
}

export function effectiveTeamWalletStatus(
  storedStatus: "AVAILABLE" | "RESERVED" | "DISABLED",
  activeReservationCount: number,
): "AVAILABLE" | "RESERVED" | "DISABLED" {
  if (storedStatus === "DISABLED") return "DISABLED";
  return activeReservationCount > 0 ? "RESERVED" : "AVAILABLE";
}

export function canManageAllTeamWallets(
  access: Pick<OrgContext, "isOwner" | "member">,
): boolean {
  return access.isOwner || access.member?.role.name === "Admin";
}

export async function ensureDefaultTeamWalletPool(organizationId: string) {
  return prisma.teamWalletPool.upsert({
    where: {
      organizationId_name: {
        organizationId,
        name: "Team Wallet Pool",
      },
    },
    create: {
      organizationId,
      name: "Team Wallet Pool",
      isDefault: true,
    },
    update: { isDefault: true },
  });
}

export async function organizationTeamMembers(
  organizationId: string,
  ownerId: string,
) {
  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          globalName: true,
          avatarUrl: true,
        },
      },
      role: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      username: true,
      globalName: true,
      avatarUrl: true,
    },
  });
  const byId = new Map(
    memberships.map((membership) => [
      membership.userId,
      {
        userId: membership.userId,
        name: membership.user.globalName ?? membership.user.username,
        avatarUrl: membership.user.avatarUrl,
        roleName: membership.role.name,
      },
    ]),
  );
  if (owner) {
    byId.set(owner.id, {
      userId: owner.id,
      name: owner.globalName ?? owner.username,
      avatarUrl: owner.avatarUrl,
      roleName: "Owner",
    });
  }
  return [...byId.values()];
}
