import type { WalletChain } from "@prisma/client";

/**
 * Chains in one family share an address format, so one `0x` wallet is valid
 * on every EVM network. Each chain is still a distinct registry identity
 * (D042): the raffle names the network it pays out on, and a profile saved
 * for ETHEREUM never stands in for INK.
 *
 * Mirrored in apps/bot/src/utils/wallets.ts — keep the two tables identical.
 */
export type WalletFamily = "EVM" | "SOLANA" | "BITCOIN" | "ZCASH";

export interface WalletChainMeta {
  label: string;
  family: WalletFamily;
  /** Short format hint for input placeholders. */
  hint: string;
}

/**
 * Display order. The original five stay first so the Discord wallet modal's
 * five slots and existing exports keep their shape; the rest follow in rough
 * order of how often the community mints on them.
 *
 * Discord caps a select menu and a slash-command choice list at 25 entries —
 * the raffle wizard and /wallet both list every chain, so stay under that.
 */
export const WALLET_CHAIN_META: Record<WalletChain, WalletChainMeta> = {
  ETHEREUM: { label: "Ethereum", family: "EVM", hint: "0x…" },
  BASE: { label: "Base", family: "EVM", hint: "0x…" },
  ROBINHOOD: { label: "Robinhood Chain (RH)", family: "EVM", hint: "0x…" },
  SOLANA: { label: "Solana", family: "SOLANA", hint: "base58 address" },
  BITCOIN: { label: "Bitcoin", family: "BITCOIN", hint: "bc1… / 1… / 3…" },
  ZCASH: {
    label: "Zcash (ZEC)",
    family: "ZCASH",
    hint: "t1… / t3… / zs1… / u1…",
  },
  ARC: { label: "Arc", family: "EVM", hint: "0x…" },
  INK: { label: "Ink", family: "EVM", hint: "0x…" },
  ABSTRACT: { label: "Abstract", family: "EVM", hint: "0x…" },
  HYPEREVM: { label: "HyperEVM", family: "EVM", hint: "0x…" },
  MONAD: { label: "Monad", family: "EVM", hint: "0x…" },
  MEGAETH: { label: "MegaETH", family: "EVM", hint: "0x…" },
  BERACHAIN: { label: "Berachain", family: "EVM", hint: "0x…" },
  APECHAIN: { label: "ApeChain", family: "EVM", hint: "0x…" },
  ARBITRUM: { label: "Arbitrum", family: "EVM", hint: "0x…" },
  OPTIMISM: { label: "Optimism", family: "EVM", hint: "0x…" },
  POLYGON: { label: "Polygon", family: "EVM", hint: "0x…" },
  BNB: { label: "BNB Chain", family: "EVM", hint: "0x…" },
  ZORA: { label: "Zora", family: "EVM", hint: "0x…" },
  SHAPE: { label: "Shape", family: "EVM", hint: "0x…" },
  SCROLL: { label: "Scroll", family: "EVM", hint: "0x…" },
  LINEA: { label: "Linea", family: "EVM", hint: "0x…" },
  BLAST: { label: "Blast", family: "EVM", hint: "0x…" },
};

export const WALLET_CHAINS = Object.keys(
  WALLET_CHAIN_META,
) as readonly WalletChain[];

/** Every chain that takes a `0x` address, in display order. */
export const EVM_CHAINS: readonly WalletChain[] = WALLET_CHAINS.filter(
  (chain) => WALLET_CHAIN_META[chain].family === "EVM",
);

/**
 * Pseudo-chain accepted by the wallet registry: one `0x` address saved to
 * every EVM chain at once. Never a stored value — callers fan it out.
 */
export const EVM_FAMILY_KEY = "EVM";

const ETH_RE = /^0x[0-9a-fA-F]{40}$/u;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
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

export function isWalletChain(value: unknown): value is WalletChain {
  return WALLET_CHAINS.includes(value as WalletChain);
}

export function walletFamily(chain: WalletChain): WalletFamily {
  return WALLET_CHAIN_META[chain].family;
}

export type WalletAddressValidation =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

function validateZcash(address: string): WalletAddressValidation {
  if (ZEC_TRANSPARENT_RE.test(address)) return { ok: true, normalized: address };
  const lower = address.toLowerCase();
  if (ZEC_SAPLING_RE.test(lower) && verifyBech32(lower, "bech32")) {
    return { ok: true, normalized: lower };
  }
  if (
    (ZEC_UNIFIED_RE.test(lower) || ZEC_TEX_RE.test(lower)) &&
    verifyBech32(lower, "bech32m")
  ) {
    return { ok: true, normalized: lower };
  }
  if (ZEC_SPROUT_RE.test(address)) {
    return {
      ok: false,
      error:
        "Sprout (zc…) addresses are retired — use a t1/t3, zs1, or u1 address.",
    };
  }
  return {
    ok: false,
    error:
      "Expected a Zcash t1/t3 (transparent), zs1 (Sapling), u1 (unified), or tex1 address.",
  };
}

export function validateWalletAddress(
  chain: WalletChain,
  raw: string,
): WalletAddressValidation {
  const address = raw.trim();
  if (!address) return { ok: false, error: "Address is empty." };
  switch (walletFamily(chain)) {
    case "EVM":
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
    case "ZCASH":
      return validateZcash(address);
  }
}

export function walletChainLabel(chain: WalletChain): string {
  return WALLET_CHAIN_META[chain]?.label ?? chain;
}

export function walletChainHint(chain: WalletChain): string {
  return WALLET_CHAIN_META[chain]?.hint ?? "";
}
