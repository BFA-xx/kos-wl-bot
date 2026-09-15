import { WalletChain } from "@kos/db";

/**
 * Lightweight wallet address validation. Intentionally format-level only
 * (no on-chain checks) — enough to reject typos and obviously wrong chains.
 *
 * Chains in one family share an address format, so one `0x` wallet is valid
 * on every EVM network. Each chain is still a distinct registry identity
 * (D042): the raffle names the network it pays out on, and a profile saved
 * for ETHEREUM never stands in for INK.
 *
 * Mirrored in apps/dashboard/lib/wallet-validation.ts — keep the tables identical.
 */
export interface WalletValidation {
  valid: boolean;
  normalized?: string;
  error?: string;
}

export type WalletFamily = "EVM" | "SOLANA" | "BITCOIN" | "ZCASH";

interface WalletChainMeta {
  label: string;
  family: WalletFamily;
}

/**
 * Display order. The original five stay first so the wallet modal's five
 * slots keep their shape. Discord caps a select menu and a slash-command
 * choice list at 25 entries — the raffle wizard and /wallet list every chain.
 */
const CHAIN_META: Record<WalletChain, WalletChainMeta> = {
  [WalletChain.ETHEREUM]: { label: "Ethereum", family: "EVM" },
  [WalletChain.BASE]: { label: "Base", family: "EVM" },
  [WalletChain.ROBINHOOD]: { label: "Robinhood Chain (RH)", family: "EVM" },
  [WalletChain.SOLANA]: { label: "Solana", family: "SOLANA" },
  [WalletChain.BITCOIN]: { label: "Bitcoin", family: "BITCOIN" },
  [WalletChain.ZCASH]: { label: "Zcash (ZEC)", family: "ZCASH" },
  [WalletChain.ARC]: { label: "Arc", family: "EVM" },
  [WalletChain.INK]: { label: "Ink", family: "EVM" },
  [WalletChain.ABSTRACT]: { label: "Abstract", family: "EVM" },
  [WalletChain.HYPEREVM]: { label: "HyperEVM", family: "EVM" },
  [WalletChain.MONAD]: { label: "Monad", family: "EVM" },
  [WalletChain.MEGAETH]: { label: "MegaETH", family: "EVM" },
  [WalletChain.BERACHAIN]: { label: "Berachain", family: "EVM" },
  [WalletChain.APECHAIN]: { label: "ApeChain", family: "EVM" },
  [WalletChain.ARBITRUM]: { label: "Arbitrum", family: "EVM" },
  [WalletChain.OPTIMISM]: { label: "Optimism", family: "EVM" },
  [WalletChain.POLYGON]: { label: "Polygon", family: "EVM" },
  [WalletChain.BNB]: { label: "BNB Chain", family: "EVM" },
  [WalletChain.ZORA]: { label: "Zora", family: "EVM" },
  [WalletChain.SHAPE]: { label: "Shape", family: "EVM" },
  [WalletChain.SCROLL]: { label: "Scroll", family: "EVM" },
  [WalletChain.LINEA]: { label: "Linea", family: "EVM" },
  [WalletChain.BLAST]: { label: "Blast", family: "EVM" },
};

/** All supported chains, in display order. */
export const ALL_CHAINS: WalletChain[] = Object.keys(CHAIN_META) as WalletChain[];

/** Every chain that takes a `0x` address, in display order. */
export const EVM_CHAINS: WalletChain[] = ALL_CHAINS.filter(
  (chain) => CHAIN_META[chain].family === "EVM",
);

/**
 * Modal field id for "one 0x address, saved to every EVM chain". Never a
 * stored value — handlers fan it out over EVM_CHAINS.
 */
export const EVM_FIELD_ID = "EVM";

/**
 * Longest address any chain accepts. Zcash unified addresses run past 200
 * characters, so modal inputs must allow more than an ETH/SOL address needs.
 */
export const MAX_ADDRESS_LENGTH = 320;

const ETH_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u; // base58, 32–44 chars
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/u;
const BTC_BECH32_RE = /^(bc1)[0-9ac-hj-np-z]{11,71}$/u;

// Zcash has four live address encodings (Sprout `zc…` is deprecated and most
// wallets can no longer pay to it, so it is rejected with a pointed message):
//  - transparent: Base58Check, 35 chars, `t1` = P2PKH / `t3` = P2SH
//  - Sapling shielded: Bech32 (BIP 173), HRP `zs`, 43-byte payload → 78 chars
//  - unified (ZIP 316): Bech32m with the 90-char limit lifted; HRP `u`, or
//    `zu` / `tu` from Revision 2. Typically 141–213 chars.
//  - TEX (ZIP 320): Bech32m, HRP `tex`, 20-byte payload → 42 chars
// Bech32 addresses are case-insensitive but single-case; they are normalized
// to lowercase. Base58 is case-sensitive and stored as typed.
const ZEC_TRANSPARENT_RE = /^t[13][a-km-zA-HJ-NP-Z1-9]{33}$/u;
const ZEC_SAPLING_RE = /^zs1[02-9ac-hj-np-z]{75}$/u;
const ZEC_UNIFIED_RE = /^(?:u|zu|tu)1[02-9ac-hj-np-z]{60,}$/u;
const ZEC_TEX_RE = /^tex1[02-9ac-hj-np-z]{38}$/u;
const ZEC_SPROUT_RE = /^zc[a-km-zA-HJ-NP-Z1-9]{93}$/u;

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >>> i) & 1) chk ^= BECH32_GENERATOR[i]!;
    }
  }
  return chk;
}

/**
 * Checksum-verify a lowercase Bech32 / Bech32m string. Length is deliberately
 * not capped: Zcash unified addresses exceed BIP 173's 90 characters by design.
 */
export function verifyBech32(
  address: string,
  variant: "bech32" | "bech32m",
): boolean {
  const separator = address.lastIndexOf("1");
  if (separator < 1 || separator + 7 > address.length) return false;
  const hrp = address.slice(0, separator);
  const values: number[] = [];
  for (const char of address.slice(separator + 1)) {
    const index = BECH32_CHARSET.indexOf(char);
    if (index < 0) return false;
    values.push(index);
  }
  const expanded: number[] = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >>> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  const checksum = bech32Polymod(expanded.concat(values));
  return checksum === (variant === "bech32" ? BECH32_CONST : BECH32M_CONST);
}

function validateZcash(address: string): WalletValidation {
  if (ZEC_TRANSPARENT_RE.test(address)) {
    return { valid: true, normalized: address };
  }
  const lower = address.toLowerCase();
  if (ZEC_SAPLING_RE.test(lower) && verifyBech32(lower, "bech32")) {
    return { valid: true, normalized: lower };
  }
  if (
    (ZEC_UNIFIED_RE.test(lower) || ZEC_TEX_RE.test(lower)) &&
    verifyBech32(lower, "bech32m")
  ) {
    return { valid: true, normalized: lower };
  }
  if (ZEC_SPROUT_RE.test(address)) {
    return {
      valid: false,
      error:
        "Sprout (zc…) addresses are retired — use a t1/t3, zs1, or u1 address.",
    };
  }
  return {
    valid: false,
    error:
      "Invalid Zcash address (expected t1/t3, zs1 Sapling, u1 unified, or tex1).",
  };
}

export function walletFamily(chain: WalletChain): WalletFamily {
  return CHAIN_META[chain]?.family ?? "EVM";
}

export function validateWallet(
  chain: WalletChain,
  raw: string,
): WalletValidation {
  const address = raw.trim();
  if (!address) return { valid: false, error: "Address is empty." };
  if (!CHAIN_META[chain]) return { valid: false, error: "Unsupported chain." };

  switch (walletFamily(chain)) {
    case "EVM":
      // Every EVM network shares the 0x address format.
      return ETH_RE.test(address)
        ? { valid: true, normalized: address.toLowerCase() }
        : {
            valid: false,
            error: `Invalid ${chainLabel(chain)} address (expected 0x + 40 hex).`,
          };

    case "SOLANA":
      return SOL_RE.test(address)
        ? { valid: true, normalized: address }
        : {
            valid: false,
            error: "Invalid Solana address (expected base58, 32–44 chars).",
          };

    case "BITCOIN":
      return BTC_LEGACY_RE.test(address) ||
        BTC_BECH32_RE.test(address.toLowerCase())
        ? { valid: true, normalized: address }
        : { valid: false, error: "Invalid Bitcoin address." };

    case "ZCASH":
      return validateZcash(address);
  }
}

export function chainLabel(chain: WalletChain): string {
  return CHAIN_META[chain]?.label ?? chain;
}

export interface ChainWallet {
  chain: WalletChain;
}

/** Never substitute a wallet from a chain the raffle did not configure. */
export function selectConfiguredWallet<
  S extends ChainWallet,
  P extends ChainWallet,
>(
  submitted: S | null | undefined,
  profiles: readonly P[],
  configuredChains: readonly WalletChain[],
): S | P | null {
  if (
    submitted &&
    (configuredChains.length === 0 ||
      configuredChains.includes(submitted.chain))
  ) {
    return submitted;
  }
  for (const chain of configuredChains) {
    const profile = profiles.find((item) => item.chain === chain);
    if (profile) return profile;
  }
  return null;
}
