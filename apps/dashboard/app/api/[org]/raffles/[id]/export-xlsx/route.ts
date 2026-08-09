import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addressesWorkbook, type AddressRow } from "@/lib/xlsx";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { raffleWalletExportRows } from "@/lib/raffle-wallet-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.WALLET_EXPORT,
    );
    const id = Number(params.id);
    const mode =
      req.nextUrl.searchParams.get("mode") === "full" ? "full" : "addresses";

    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { projectName: true, walletChains: true },
    });
    if (!raffle) return new Response("not found", { status: 404 });

    const rows: AddressRow[] = (
      await raffleWalletExportRows(id, raffle.walletChains)
    ).map((row) => ({
      username: row.username,
      chain: row.chain,
      address: row.address,
      source: row.source,
      teamMember: row.teamMember,
    }));

    const buf = await addressesWorkbook(raffle.projectName, rows, mode);
    const safe = raffle.projectName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="KOS-x-${safe}-${id}.xlsx"`,
      },
    });
  } catch (err) {
    if (err instanceof AccessError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
