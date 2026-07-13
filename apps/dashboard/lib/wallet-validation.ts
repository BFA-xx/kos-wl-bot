import type { WalletChain } from "@prisma/client";

export const WALLET_CHAINS = [
  "ETHEREUM",
  "BASE",
  "SOLANA",
  "BITCOIN",
] as const satisfies readonly WalletChain[];

const ETH_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/u;
const BTC_BECH32_RE = /^(bc1)[0-9ac-hj-np-z]{11,71}$/u;

export function isWalletChain(value: unknown): value is WalletChain {
  return WALLET_CHAINS.includes(value as WalletChain);
}

export function validateWalletAddress(
  chain: WalletChain,
  raw: string,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const address = raw.trim();
  if (!address) return { ok: false, error: "Address is empty." };
  switch (chain) {
    case "ETHEREUM":
    case "BASE":
      return ETH_RE.test(address)
        ? { ok: true, normalized: address.toLowerCase() }
        : {
            ok: false,
            error: "Expected 0x followed by 40 hexadecimal characters.",
          };
    case "SOLANA":
      return SOL_RE.test(address)
        ? { ok: true, normalized: address }
        : { ok: false, error: "Expected a 32–44 character base58 address." };
    case "BITCOIN":
      return BTC_LEGACY_RE.test(address) ||
        BTC_BECH32_RE.test(address.toLowerCase())
        ? { ok: true, normalized: address }
        : { ok: false, error: "Expected a valid legacy or bech32 address." };
  }
}
