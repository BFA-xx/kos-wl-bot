import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  EVM_CHAINS,
  EVM_FAMILY_KEY,
  isWalletChain,
  validateWalletAddress,
} from "@/lib/wallet-validation";
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

/**
 * Add or update the wallet for a chain — same as /wallet register|set.
 * `chain: "EVM"` saves one `0x` address to every EVM network at once, the
 * same fan-out the Discord wallet modal performs; a later per-chain save
 * overrides just that network.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requested = String(body.chain ?? "");
  const chains: readonly WalletChain[] =
    requested === EVM_FAMILY_KEY
      ? EVM_CHAINS
      : isWalletChain(requested)
        ? [requested]
        : [];
  if (chains.length === 0) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  const v = validateWalletAddress(chains[0], String(body.address ?? ""));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const stored = encryptSecret(v.normalized);
  await prisma.$transaction(
    chains.map((chain) =>
      prisma.walletProfile.upsert({
        where: { userId_chain: { userId: user.id, chain } },
        create: { userId: user.id, chain, address: stored },
        update: { address: stored },
      }),
    ),
  );
  return NextResponse.json({ ok: true, chains });
}

/** Remove the wallet for a chain — same as /wallet remove. `chain=EVM` clears every EVM network. */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const requested = req.nextUrl.searchParams.get("chain") ?? "";
  const chains: readonly WalletChain[] =
    requested === EVM_FAMILY_KEY
      ? EVM_CHAINS
      : isWalletChain(requested)
        ? [requested]
        : [];
  if (chains.length === 0) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  await prisma.walletProfile.deleteMany({
    where: { userId: user.id, chain: { in: [...chains] } },
  });
  return NextResponse.json({ ok: true });
}
