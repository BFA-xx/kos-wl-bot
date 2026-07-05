import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import type { WalletChain } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"] as const;

// Same format-level validation the bot uses in /wallet register.
const ETH_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/u;
const BTC_BECH32_RE = /^(bc1)[0-9ac-hj-np-z]{11,71}$/u;

function validate(chain: WalletChain, raw: string): { ok: true; normalized: string } | { ok: false; error: string } {
  const address = raw.trim();
  if (!address) return { ok: false, error: "Address is empty." };
  switch (chain) {
    case "ETHEREUM":
    case "BASE":
      return ETH_RE.test(address)
        ? { ok: true, normalized: address.toLowerCase() }
        : { ok: false, error: "Invalid address — expected 0x followed by 40 hex characters." };
    case "SOLANA":
      return SOL_RE.test(address)
        ? { ok: true, normalized: address }
        : { ok: false, error: "Invalid Solana address (base58, 32–44 chars)." };
    case "BITCOIN":
      return BTC_LEGACY_RE.test(address) || BTC_BECH32_RE.test(address.toLowerCase())
        ? { ok: true, normalized: address }
        : { ok: false, error: "Invalid Bitcoin address." };
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await prisma.walletProfile.findMany({
    where: { userId: user.id },
    orderBy: { chain: "asc" },
  });
  return NextResponse.json({
    wallets: rows.map((w) => ({ chain: w.chain, address: decryptSecret(w.address), updatedAt: w.updatedAt })),
  });
}

/** Add or update the wallet for a chain — same as /wallet register|set. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chain = String(body.chain ?? "") as WalletChain;
  if (!CHAINS.includes(chain as (typeof CHAINS)[number])) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  const v = validate(chain, String(body.address ?? ""));
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
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chain = req.nextUrl.searchParams.get("chain") as WalletChain | null;
  if (!chain || !CHAINS.includes(chain as (typeof CHAINS)[number])) {
    return NextResponse.json({ error: "Unknown chain." }, { status: 400 });
  }
  await prisma.walletProfile
    .delete({ where: { userId_chain: { userId: user.id, chain } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
