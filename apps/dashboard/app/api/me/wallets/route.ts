import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { isWalletChain, validateWalletAddress } from "@/lib/wallet-validation";
import type { WalletChain } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.walletProfile.findMany({
    where: { userId: user.id },
    orderBy: { chain: "asc" },
  });
  return NextResponse.json({
    wallets: rows.map((w) => ({
      chain: w.chain,
      address: decryptSecret(w.address),
      updatedAt: w.updatedAt,
    })),
  });
}

/** Add or update the wallet for a chain — same as /wallet register|set. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chain = String(body.chain ?? "") as WalletChain;
  if (!isWalletChain(chain)) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  const v = validateWalletAddress(chain, String(body.address ?? ""));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const stored = encryptSecret(v.normalized);
  await prisma.walletProfile.upsert({
    where: { userId_chain: { userId: user.id, chain } },
    create: { userId: user.id, chain, address: stored },
    update: { address: stored },
  });
  return NextResponse.json({ ok: true });
}

/** Remove the wallet for a chain — same as /wallet remove. */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chain = req.nextUrl.searchParams.get("chain") as WalletChain | null;
  if (!chain || !isWalletChain(chain)) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  await prisma.walletProfile
    .delete({ where: { userId_chain: { userId: user.id, chain } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
