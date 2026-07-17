import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { selectConfiguredWallet } from "@/lib/winner-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Winner wallets across this org's raffles (submitted wallet, falling back to
 * the winner's registered profile). Strictly scoped to the org's guilds.
 */
export async function GET(
  _req: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.WALLET_VIEW,
    );

    const winners = await prisma.winner.findMany({
      where: { replaced: false, raffle: { guildId: { in: guildIds } } },
      orderBy: [{ raffleId: "desc" }, { position: "asc" }],
      take: 2000,
      include: {
        wallet: true,
        raffle: { select: { id: true, projectName: true, walletChains: true } },
      },
    });

    const userIds = winners.map((winner) => winner.userId);
    const profiles = userIds.length
      ? await prisma.walletProfile.findMany({
          where: { userId: { in: userIds } },
        })
      : [];

    const rows = winners.map((w) => {
      const src = selectConfiguredWallet(
        w.wallet,
        profiles.filter((profile) => profile.userId === w.userId),
        w.raffle.walletChains,
      );
      return {
        raffleId: w.raffle.id,
        projectName: w.raffle.projectName,
        position: w.position,
        userId: w.userId,
        username: w.username,
        chain: (src?.chain as string) ?? null,
        address: src ? decryptSecret(src.address) : null,
        source:
          src && src === w.wallet ? "submitted" : src ? "profile" : "missing",
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
