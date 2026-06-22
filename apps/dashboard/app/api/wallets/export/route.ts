import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.walletProfile.findMany({
    orderBy: [{ userId: "asc" }, { chain: "asc" }],
    include: { user: { select: { username: true } } },
  });
  const csv = toCsv(
    ["discord_id", "username", "chain", "wallet_address", "updated_at"],
    rows.map((r) => [
      r.userId,
      r.user.username,
      r.chain,
      decryptSecret(r.address),
      r.updatedAt.toISOString(),
    ]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wallet-registry.csv"`,
    },
  });
}
