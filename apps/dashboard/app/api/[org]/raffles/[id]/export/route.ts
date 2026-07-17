import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { decryptSecret } from "@/lib/crypto";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { selectConfiguredWallet } from "@/lib/winner-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const type = req.nextUrl.searchParams.get("type") ?? "winners";
    const perm =
      type === "winners"
        ? PERMISSIONS.WALLET_EXPORT
        : PERMISSIONS.REPORT_EXPORT;
    const { guildIds } = await requireOrgAccess(params.org, perm);
    const id = Number(params.id);

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { id: true, walletChains: true },
    });
    if (!raffle)
      return NextResponse.json({ error: "not found" }, { status: 404 });

    let csv: string;
    let filename: string;
    if (type === "participants") {
      const rows = await prisma.participant.findMany({
        where: { raffleId: id },
        orderBy: { enteredAt: "asc" },
      });
      csv = toCsv(
        ["discord_id", "username", "entered_at", "flagged", "flag_reason"],
        rows.map((r) => [
          r.userId,
          r.username,
          r.enteredAt.toISOString(),
          r.flagged ? "yes" : "no",
          r.flagReason ?? "",
        ]),
      );
      filename = `participants-${id}.csv`;
    } else {
      const rows = await prisma.winner.findMany({
        where: { raffleId: id, replaced: false },
        orderBy: { position: "asc" },
        include: { wallet: true },
      });
      const userIds = rows.map((winner) => winner.userId);
      const profiles = userIds.length
        ? await prisma.walletProfile.findMany({
            where: { userId: { in: userIds } },
          })
        : [];
      csv = toCsv(
        [
          "position",
          "discord_id",
          "username",
          "chain",
          "wallet_address",
          "submitted_at",
        ],
        rows.map((r) => {
          const source = selectConfiguredWallet(
            r.wallet,
            profiles.filter((profile) => profile.userId === r.userId),
            raffle.walletChains,
          );
          const submitted = source !== null && source === r.wallet;
          return [
            r.position,
            r.userId,
            r.username,
            source?.chain ?? "",
            source ? decryptSecret(source.address) : "",
            submitted && r.wallet?.submittedAt
              ? r.wallet.submittedAt.toISOString()
              : "",
          ];
        }),
      );
      filename = `winners-${id}.csv`;
    }

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
