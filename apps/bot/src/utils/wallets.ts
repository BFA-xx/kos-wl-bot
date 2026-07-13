import { WalletChain } from "@kos/db";

/**
 * Lightweight wallet address validation. Intentionally format-level only
 * (no on-chain checks) — enough to reject typos and obviously wrong chains.
 */
export interface WalletValidation {
  valid: boolean;
  normalized?: string;
  error?: string;
}

const ETH_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u; // base58, 32–44 chars
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/u;
const BTC_BECH32_RE = /^(bc1)[0-9ac-hj-np-z]{11,71}$/u;

export function validateWallet(
  chain: WalletChain,
  raw: string,
): WalletValidation {
  const address = raw.trim();
  if (!address) return { valid: false, error: "Address is empty." };

  switch (chain) {
    case WalletChain.ETHEREUM:
    case WalletChain.BASE:
    case WalletChain.ROBINHOOD:
      // Base and Robinhood Chain are EVM networks — same 0x address format.
      return ETH_RE.test(address)
        ? { valid: true, normalized: address.toLowerCase() }
        : { valid: false, error: `Invalid ${chainLabel(chain)} address (expected 0x + 40 hex).` };

    case WalletChain.SOLANA:
      return SOL_RE.test(address)
        ? { valid: true, normalized: address }
        : { valid: false, error: "Invalid Solana address (expected base58, 32–44 chars)." };

    case WalletChain.BITCOIN:
      return BTC_LEGACY_RE.test(address) || BTC_BECH32_RE.test(address.toLowerCase())
        ? { valid: true, normalized: address }
        : { valid: false, error: "Invalid Bitcoin address." };

    default:
      return { valid: false, error: "Unsupported chain." };
  }
}

export function chainLabel(chain: WalletChain): string {
  switch (chain) {
    case WalletChain.ETHEREUM:
      return "Ethereum";
    case WalletChain.BASE:
      return "Base";
    case WalletChain.ROBINHOOD:
      return "Robinhood Chain (RH)";
    case WalletChain.SOLANA:
      return "Solana";
    case WalletChain.BITCOIN:
      return "Bitcoin";
    default:
      return chain;
  }
}

/** All supported chains, in display order. */
export const ALL_CHAINS: WalletChain[] = [
  WalletChain.ETHEREUM,
  WalletChain.BASE,
  WalletChain.ROBINHOOD,
  WalletChain.SOLANA,
  WalletChain.BITCOIN,
];
