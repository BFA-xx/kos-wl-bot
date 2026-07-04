import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { decryptSecret } from "@/lib/crypto";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV of every winner wallet across the org's raffles. */
export async function GET(_req: Request, { params }: { params: { org: string } }) {
  try {
    const { guildIds } = await requireOrgAccess(params.org, PERMISSIONS.WALLET_EXPORT);

    const winners = await prisma.winner.findMany({
      where: { replaced: false, raffle: { guildId: { in: guildIds } } },
      orderBy: [{ raffleId: "desc" }, { position: "asc" }],
      include: { wallet: true, raffle: { select: { id: true, projectName: true, walletChains: true } } },
    });
    const missing = winners.filter((w) => !w.wallet).map((w) => w.userId);
    const profiles = missing.length
      ? await prisma.walletProfile.findMany({ where: { userId: { in: missing } } })
      : [];
    const profileFor = (userId: string, chains: string[]) => {
      const owned = profiles.filter((p) => p.userId === userId);
      for (const c of chains) {
        const hit = owned.find((p) => p.chain === c);
        if (hit) return hit;
      }
      return owned[0] ?? null;
    };

    const csv = toCsv(
      ["raffle_id", "project", "position", "discord_id", "username", "chain", "wallet_address"],
      winners.map((w) => {
        const src = w.wallet ?? profileFor(w.userId, w.raffle.walletChains as string[]);
        return [
          w.raffle.id,
          w.raffle.projectName,
          w.position,
          w.userId,
          w.username,
          src?.chain ?? "",
          src ? decryptSecret(src.address) : "",
        ];
      }),
    );

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${params.org}-winner-wallets.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
