import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  const type = req.nextUrl.searchParams.get("type") ?? "winners";

  let csv: string;
  let filename: string;

  if (type === "participants") {
    const rows = await prisma.participant.findMany({
      where: { raffleId: id },
      orderBy: { enteredAt: "asc" },
    });
    csv = toCsv(
      ["discord_id", "username", "entered_at", "flagged", "flag_reason"],
      rows.map((r) => [r.userId, r.username, r.enteredAt.toISOString(), r.flagged ? "yes" : "no", r.flagReason ?? ""]),
    );
    filename = `participants-${id}.csv`;
  } else {
    const rows = await prisma.winner.findMany({
      where: { raffleId: id, replaced: false },
      orderBy: { position: "asc" },
      include: { wallet: true },
    });
    csv = toCsv(
      ["position", "discord_id", "username", "chain", "wallet_address", "submitted_at"],
      rows.map((r) => [
        r.position,
        r.userId,
        r.username,
        r.wallet?.chain ?? "",
        r.wallet ? decryptSecret(r.wallet.address) : "",
        r.wallet?.submittedAt ? r.wallet.submittedAt.toISOString() : "",
      ]),
    );
    filename = `winners-${id}.csv`;
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
