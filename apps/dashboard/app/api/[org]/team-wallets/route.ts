import { NextResponse } from "next/server";
import type { WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import {
  canManageAllTeamWallets,
  ensureDefaultTeamWalletPool,
  organizationTeamMembers,
} from "@/lib/team-wallet-server";
import { isWalletChain } from "@/lib/wallet-validation";
import { parseTeamWalletImport } from "@/lib/team-wallet-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAccess(async (request, { params }) => {
  const access = await requireOrgAccess(params.org);
  const pool = await ensureDefaultTeamWalletPool(access.org.id);
  const canManageAll = canManageAllTeamWallets(access);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(
    250,
    Math.max(25, Number(url.searchParams.get("pageSize") ?? 100) || 100),
  );

  const [wallets, members, poolMembers] = await Promise.all([
    prisma.teamWallet.findMany({
      where: {
        poolId: pool.id,
        deletedAt: null,
        ...(canManageAll ? {} : { ownerId: access.user.id }),
      },
      include: {
        owner: { select: { id: true, username: true, globalName: true } },
        usages: {
          orderBy: { reservedAt: "desc" },
          take: 20,
          select: {
            id: true,
            raffleId: true,
            projectName: true,
            status: true,
            reservedAt: true,
            releasedAt: true,
            raffle: { select: { title: true, status: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    organizationTeamMembers(access.org.id, access.org.ownerId),
    prisma.teamWalletPoolMember.findMany({
      where: { poolId: pool.id },
      select: { userId: true, priority: true },
    }),
  ]);

  const serialized = wallets.map((wallet) => ({
    id: wallet.id,
    ownerId: wallet.ownerId,
    ownerName: wallet.owner.globalName ?? wallet.owner.username,
    chain: wallet.chain,
    address: decryptSecret(wallet.address),
    status: wallet.status,
    timesUsed: wallet.timesUsed,
    lastUsedAt: wallet.lastUsedAt,
    createdAt: wallet.createdAt,
    history: wallet.usages.map((usage) => ({
      id: usage.id,
      raffleId: usage.raffleId,
      raffleTitle: usage.raffle.title,
      raffleStatus: usage.raffle.status,
      project: usage.projectName,
      status: usage.status,
      reservedAt: usage.reservedAt,
      releasedAt: usage.releasedAt,
    })),
  }));
  const filtered = query
    ? serialized.filter((wallet) =>
        [wallet.address, wallet.ownerName, wallet.chain, wallet.status].some(
          (value) => value.toLowerCase().includes(query),
        ),
      )
    : serialized;
  const start = (page - 1) * pageSize;

  const allPoolWallets = canManageAll
    ? wallets
    : await prisma.teamWallet.findMany({
        where: { poolId: pool.id, deletedAt: null },
        include: {
          owner: { select: { id: true, username: true, globalName: true } },
        },
      });
  const statusCounts = { AVAILABLE: 0, RESERVED: 0, DISABLED: 0 };
  const useByOwner = new Map<string, number>();
  for (const wallet of allPoolWallets) {
    statusCounts[wallet.status] += 1;
    useByOwner.set(
      wallet.ownerId,
      (useByOwner.get(wallet.ownerId) ?? 0) + wallet.timesUsed,
    );
  }
  const memberById = new Map(members.map((member) => [member.userId, member]));
  const mostActive = [...useByOwner.entries()]
    .filter(([, uses]) => uses > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const priorityByUser = new Map(
    poolMembers.map((member) => [member.userId, member.priority]),
  );
  const orderedMembers = [...members]
    .map((member, index) => ({
      ...member,
      priority: priorityByUser.get(member.userId) ?? index,
    }))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  return NextResponse.json({
    pool: {
      id: pool.id,
      selectionMode: pool.selectionMode,
    },
    viewer: {
      userId: access.user.id,
      canManageAll,
      canFill:
        access.isOwner || access.permissions.includes("team-wallet:fill"),
    },
    members: orderedMembers,
    wallets: filtered.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
    stats: {
      total: allPoolWallets.length,
      available: statusCounts.AVAILABLE,
      reserved: statusCounts.RESERVED,
      disabled: statusCounts.DISABLED,
      totalTeamMembers: members.length,
      mostUsedWallets: [...allPoolWallets]
        .filter((wallet) => wallet.timesUsed > 0)
        .sort(
          (a, b) =>
            b.timesUsed - a.timesUsed ||
            (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0),
        )
        .slice(0, 5)
        .map((wallet) => ({
          id: wallet.id,
          address: decryptSecret(wallet.address),
          ownerName: wallet.owner.globalName ?? wallet.owner.username,
          timesUsed: wallet.timesUsed,
        })),
      mostActiveTeamMember: mostActive
        ? {
            userId: mostActive[0],
            name: memberById.get(mostActive[0])?.name ?? mostActive[0],
            timesUsed: mostActive[1],
          }
        : null,
    },
  });
});

export const POST = withAccess(async (request, { params }) => {
  const access = await requireOrgAccess(params.org);
  const canManageAll = canManageAllTeamWallets(access);
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const ownerId =
    typeof body.ownerId === "string" && body.ownerId.trim()
      ? body.ownerId.trim()
      : access.user.id;
  const defaultChain = String(body.defaultChain ?? "ETHEREUM").toUpperCase();
  if (ownerId !== access.user.id && !canManageAll) {
    return NextResponse.json(
      { error: "You can only add wallets to your own pool." },
      { status: 403 },
    );
  }
  if (!content.trim()) {
    return NextResponse.json(
      { error: "Paste wallet addresses or choose a CSV/TXT file." },
      { status: 400 },
    );
  }
  if (content.length > 1_000_000) {
    return NextResponse.json(
      { error: "Wallet imports must be 1 MB or smaller." },
      { status: 413 },
    );
  }
  if (!isWalletChain(defaultChain)) {
    return NextResponse.json(
      { error: "Unknown default chain." },
      { status: 400 },
    );
  }
  const members = await organizationTeamMembers(
    access.org.id,
    access.org.ownerId,
  );
  if (!members.some((member) => member.userId === ownerId)) {
    return NextResponse.json(
      { error: "Wallet owner must be an active team member." },
      { status: 400 },
    );
  }

  const parsed = parseTeamWalletImport(content, defaultChain as WalletChain);
  const existing = parsed.rows.length
    ? await prisma.teamWallet.findMany({
        where: {
          addressHash: { in: parsed.rows.map((row) => row.addressHash) },
        },
        select: { addressHash: true },
      })
    : [];
  const duplicateHashes = new Set(existing.map((wallet) => wallet.addressHash));
  const accepted = parsed.rows.filter(
    (row) => !duplicateHashes.has(row.addressHash),
  );
  const errors = [
    ...parsed.errors,
    ...parsed.rows
      .filter((row) => duplicateHashes.has(row.addressHash))
      .map((row) => ({
        row: row.row,
        error: "This wallet already exists in a Team Wallet Pool.",
      })),
  ];
  if (!accepted.length) {
    return NextResponse.json(
      {
        error: "No wallet addresses could be added.",
        imported: 0,
        errors: errors.slice(0, 100),
      },
      { status: 422 },
    );
  }

  const pool = await ensureDefaultTeamWalletPool(access.org.id);
  const seatCount = await prisma.teamWalletPoolMember.count({
    where: { poolId: pool.id },
  });
  const result = await prisma.$transaction(async (tx) => {
    await tx.teamWalletPoolMember.upsert({
      where: { poolId_userId: { poolId: pool.id, userId: ownerId } },
      create: { poolId: pool.id, userId: ownerId, priority: seatCount },
      update: {},
    });
    return tx.teamWallet.createMany({
      data: accepted.map((row) => ({
        poolId: pool.id,
        ownerId,
        chain: row.chain,
        address: encryptSecret(row.address),
        addressHash: row.addressHash,
      })),
      skipDuplicates: true,
    });
  });
  await logAudit(access.org.id, access.user.id, "TEAM_WALLETS_IMPORTED", {
    targetType: "team_wallet_pool",
    targetId: pool.id,
    metadata: {
      ownerId,
      imported: result.count,
      rejected: errors.length + accepted.length - result.count,
    },
  });
  return NextResponse.json({
    imported: result.count,
    errors: errors.slice(0, 100),
  });
});
