import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { canManageAllTeamWallets } from "@/lib/team-wallet-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function accessibleWallet(orgId: string, walletId: string) {
  return prisma.teamWallet.findFirst({
    where: {
      id: walletId,
      deletedAt: null,
      pool: { organizationId: orgId },
    },
    select: { id: true, ownerId: true, status: true, poolId: true },
  });
}

export const PATCH = withAccess(async (request, { params }) => {
  const access = await requireOrgAccess(params.org);
  const wallet = await accessibleWallet(access.org.id, params.walletId);
  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found." }, { status: 404 });
  }
  if (wallet.ownerId !== access.user.id && !canManageAllTeamWallets(access)) {
    return NextResponse.json(
      { error: "You can only manage your own wallets." },
      { status: 403 },
    );
  }
  if (wallet.status === "RESERVED") {
    return NextResponse.json(
      { error: "Reserved wallets must be released from the cancelled raffle." },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled must be true or false." },
      { status: 400 },
    );
  }
  const status = body.enabled ? "AVAILABLE" : "DISABLED";
  await prisma.teamWallet.update({
    where: { id: wallet.id },
    data: { status },
  });
  await logAudit(access.org.id, access.user.id, "TEAM_WALLET_STATUS_CHANGED", {
    targetType: "team_wallet",
    targetId: wallet.id,
    metadata: { ownerId: wallet.ownerId, status },
  });
  return NextResponse.json({ ok: true, status });
});

export const DELETE = withAccess(async (_request, { params }) => {
  const access = await requireOrgAccess(params.org);
  const wallet = await accessibleWallet(access.org.id, params.walletId);
  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found." }, { status: 404 });
  }
  if (wallet.ownerId !== access.user.id && !canManageAllTeamWallets(access)) {
    return NextResponse.json(
      { error: "You can only manage your own wallets." },
      { status: 403 },
    );
  }
  if (wallet.status === "RESERVED") {
    return NextResponse.json(
      { error: "Release this wallet from its raffle before deleting it." },
      { status: 409 },
    );
  }
  await prisma.teamWallet.update({
    where: { id: wallet.id },
    data: { status: "DISABLED", deletedAt: new Date() },
  });
  await logAudit(access.org.id, access.user.id, "TEAM_WALLET_DELETED", {
    targetType: "team_wallet",
    targetId: wallet.id,
    metadata: { ownerId: wallet.ownerId },
  });
  return NextResponse.json({ ok: true });
});
