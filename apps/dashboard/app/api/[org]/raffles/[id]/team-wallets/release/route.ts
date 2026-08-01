import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { canManageAllTeamWallets } from "@/lib/team-wallet-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withAccess(async (_request, { params }) => {
  const access = await requireOrgAccess(params.org);
  if (!canManageAllTeamWallets(access)) {
    return NextResponse.json(
      { error: "Only organization admins can release team wallets." },
      { status: 403 },
    );
  }
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const raffle = await prisma.raffle.findFirst({
    where: { id: raffleId, guildId: { in: access.guildIds } },
    select: { id: true, status: true },
  });
  if (!raffle) {
    return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
  }
  if (raffle.status !== "CANCELLED") {
    return NextResponse.json(
      { error: "Team wallets can only be released from a cancelled raffle." },
      { status: 409 },
    );
  }
  const now = new Date();
  const released = await prisma.$transaction(async (tx) => {
    const usages = await tx.teamWalletUsage.findMany({
      where: { raffleId, status: "RESERVED" },
      select: { id: true, walletId: true },
    });
    if (!usages.length) return 0;
    await tx.teamWalletUsage.updateMany({
      where: { id: { in: usages.map((usage) => usage.id) } },
      data: {
        status: "RELEASED",
        releasedAt: now,
        releasedById: access.user.id,
      },
    });
    await tx.teamWallet.updateMany({
      where: {
        id: { in: usages.map((usage) => usage.walletId) },
        status: "RESERVED",
        deletedAt: null,
      },
      data: { status: "AVAILABLE" },
    });
    return usages.length;
  });
  await logAudit(
    access.org.id,
    access.user.id,
    "RAFFLE_TEAM_WALLETS_RELEASED",
    {
      targetType: "raffle",
      targetId: String(raffleId),
      metadata: { released },
    },
  );
  return NextResponse.json({ ok: true, released });
});
