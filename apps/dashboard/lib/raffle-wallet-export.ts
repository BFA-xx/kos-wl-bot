import type { Prisma, WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { selectConfiguredWallet } from "@/lib/winner-wallet";
import { validateWalletAddress } from "@/lib/wallet-validation";
import {
  teamWalletAddressHash,
  teamWalletChains,
} from "@/lib/team-wallet-pool";

export interface RaffleWalletExportRow {
  position: number | null;
  userId: string;
  username: string;
  chain: WalletChain;
  address: string;
  source: "Community" | "Team Pool";
  recordedAt: Date | null;
  addressHash: string;
}

type CommunityWalletDb = Pick<
  Prisma.TransactionClient,
  "winner" | "walletProfile"
>;

export async function communityRaffleWalletRows(
  raffleId: number,
  configuredChains: readonly WalletChain[],
  db: CommunityWalletDb = prisma,
): Promise<RaffleWalletExportRow[]> {
  const winners = await db.winner.findMany({
    where: { raffleId, replaced: false },
    orderBy: { position: "asc" },
    include: { wallet: true },
  });
  const userIds = winners.map((winner) => winner.userId);
  const profiles = userIds.length
    ? await db.walletProfile.findMany({ where: { userId: { in: userIds } } })
    : [];
  const byUser = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const existing = byUser.get(profile.userId) ?? [];
    existing.push(profile);
    byUser.set(profile.userId, existing);
  }

  const seen = new Set<string>();
  const rows: RaffleWalletExportRow[] = [];
  for (const winner of winners) {
    const source = selectConfiguredWallet(
      winner.wallet,
      byUser.get(winner.userId) ?? [],
      configuredChains,
    );
    if (!source) continue;
    const plain = decryptSecret(source.address);
    const validation = validateWalletAddress(source.chain, plain);
    if (!validation.ok) continue;
    const addressHash = teamWalletAddressHash(
      source.chain,
      validation.normalized,
    );
    if (seen.has(addressHash)) continue;
    seen.add(addressHash);
    rows.push({
      position: winner.position,
      userId: winner.userId,
      username: winner.username,
      chain: source.chain,
      address: validation.normalized,
      source: "Community",
      recordedAt:
        source === winner.wallet && winner.wallet?.submittedAt
          ? winner.wallet.submittedAt
          : null,
      addressHash,
    });
  }
  return rows;
}

export async function raffleWalletExportRows(
  raffleId: number,
  configuredChains: readonly WalletChain[],
): Promise<RaffleWalletExportRow[]> {
  const community = await communityRaffleWalletRows(raffleId, configuredChains);
  const seen = new Set(community.map((row) => row.addressHash));
  const usages = await prisma.teamWalletUsage.findMany({
    where: {
      raffleId,
      status: "RESERVED",
      wallet: { deletedAt: null },
    },
    orderBy: { reservedAt: "asc" },
    include: {
      wallet: {
        include: {
          owner: { select: { id: true, username: true, globalName: true } },
        },
      },
    },
  });
  const team: RaffleWalletExportRow[] = [];
  for (const usage of usages) {
    const plain = decryptSecret(usage.wallet.address);
    const chain = configuredChains.find((configuredChain) =>
      teamWalletChains(usage.wallet).includes(configuredChain),
    );
    if (!chain) continue;
    const validation = validateWalletAddress(chain, plain);
    if (!validation.ok || seen.has(usage.wallet.addressHash)) continue;
    seen.add(usage.wallet.addressHash);
    team.push({
      position: null,
      userId: usage.wallet.owner.id,
      username: usage.wallet.owner.globalName ?? usage.wallet.owner.username,
      chain,
      address: validation.normalized,
      source: "Team Pool",
      recordedAt: usage.reservedAt,
      addressHash: usage.wallet.addressHash,
    });
  }
  return [...community, ...team];
}
