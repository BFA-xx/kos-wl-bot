import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.walletProfile.findMany({
    orderBy: [{ user: { username: "asc" } }, { chain: "asc" }],
    include: { user: { select: { username: true } } },
  });
  return NextResponse.json({
    rows: rows.map((r) => ({
      userId: r.userId,
      username: r.user.username,
      chain: r.chain as string,
      address: decryptSecret(r.address),
      updatedAt: r.updatedAt,
    })),
  });
}
