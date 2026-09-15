import { describe, expect, it } from "vitest";
import {
  EVM_CHAINS,
  WALLET_CHAINS,
  WALLET_CHAIN_META,
  isWalletChain,
  validateWalletAddress,
  verifyBech32,
  walletChainLabel,
  walletFamily,
} from "./wallet-validation";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** Reference Bech32/Bech32m encoder so tests can mint addresses with a valid checksum. */
function bech32Encode(
  hrp: string,
  bytes: number[],
  variant: "bech32" | "bech32m",
): string {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);

  const polymod = (values: number[]) => {
    const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ value;
      for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= gen[i];
    }
    return chk;
  };
  const expanded = [...hrp]
    .map((c) => c.charCodeAt(0) >>> 5)
    .concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const target = variant === "bech32" ? 1 : 0x2bc830a3;
  const pm = polymod(expanded.concat(words, [0, 0, 0, 0, 0, 0])) ^ target;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) checksum.push((pm >>> (5 * (5 - i))) & 31);
  return `${hrp}1${words.concat(checksum).map((w) => CHARSET[w]).join("")}`;
}

const EVM_ADDRESS = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("wallet chain registry", () => {
  it("fits Discord's 25-entry cap for select menus and slash choices", () => {
    expect(WALLET_CHAINS.length).toBeLessThanOrEqual(25);
  });

  it("keeps the original five chains first so the Discord modal slots stay stable", () => {
    expect(WALLET_CHAINS.slice(0, 5)).toEqual([
      "ETHEREUM",
      "BASE",
      "ROBINHOOD",
      "SOLANA",
      "BITCOIN",
    ]);
  });

  it("labels every chain and knows the new networks", () => {
    for (const chain of WALLET_CHAINS) {
      expect(walletChainLabel(chain)).toBe(WALLET_CHAIN_META[chain].label);
      expect(isWalletChain(chain)).toBe(true);
    }
    expect(walletChainLabel("ZCASH")).toBe("Zcash (ZEC)");
    expect(walletChainLabel("ARC")).toBe("Arc");
    expect(walletChainLabel("INK")).toBe("Ink");
    expect(walletChainLabel("HYPEREVM")).toBe("HyperEVM");
    expect(isWalletChain("EVM")).toBe(false);
    expect(isWalletChain("DOGE")).toBe(false);
  });

  it("groups every 0x chain into the EVM family and nothing else", () => {
    expect(EVM_CHAINS).toContain("ETHEREUM");
    expect(EVM_CHAINS).toContain("ROBINHOOD");
    expect(EVM_CHAINS).toContain("ARC");
    expect(EVM_CHAINS).toContain("INK");
    expect(EVM_CHAINS).toContain("ABSTRACT");
    expect(EVM_CHAINS).toContain("HYPEREVM");
    expect(EVM_CHAINS).not.toContain("SOLANA");
    expect(EVM_CHAINS).not.toContain("BITCOIN");
    expect(EVM_CHAINS).not.toContain("ZCASH");
    expect(walletFamily("ZCASH")).toBe("ZCASH");
  });
});

describe("Robinhood Chain wallet support", () => {
  it("recognizes Robinhood as a selectable wallet chain", () => {
    expect(isWalletChain("ROBINHOOD")).toBe(true);
    expect(walletChainLabel("ROBINHOOD")).toBe("Robinhood Chain (RH)");
  });

  it("uses EVM address validation and lowercase normalization", () => {
    expect(validateWalletAddress("ROBINHOOD", EVM_ADDRESS)).toEqual({
      ok: true,
      normalized: EVM_ADDRESS.toLowerCase(),
    });
    expect(validateWalletAddress("ROBINHOOD", "RH123").ok).toBe(false);
  });
});

describe("EVM networks", () => {
  it("validates every EVM chain with the same 0x rule", () => {
    for (const chain of EVM_CHAINS) {
      expect(validateWalletAddress(chain, EVM_ADDRESS)).toEqual({
        ok: true,
        normalized: EVM_ADDRESS.toLowerCase(),
      });
      expect(validateWalletAddress(chain, "0x1234").ok).toBe(false);
      expect(
        validateWalletAddress(chain, "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs").ok,
      ).toBe(false);
    }
  });
});

describe("bech32 checksum", () => {
  it("accepts the BIP 173 / BIP 350 reference vectors", () => {
    expect(verifyBech32("a12uel5l", "bech32")).toBe(true);
    expect(
      verifyBech32("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "bech32"),
    ).toBe(true);
    expect(verifyBech32("a1lqfn3a", "bech32m")).toBe(true);
    expect(
      verifyBech32("abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx", "bech32m"),
    ).toBe(true);
  });

  it("rejects the wrong variant and a flipped character", () => {
    expect(verifyBech32("a12uel5l", "bech32m")).toBe(false);
    expect(verifyBech32("a1lqfn3a", "bech32")).toBe(false);
    expect(verifyBech32("a12uel5x", "bech32")).toBe(false);
    expect(verifyBech32("1qqq", "bech32")).toBe(false);
  });

  it("round-trips the reference encoder", () => {
    expect(verifyBech32(bech32Encode("zs", [1, 2, 3], "bech32"), "bech32")).toBe(
      true,
    );
    expect(verifyBech32(bech32Encode("u", [9, 9], "bech32m"), "bech32m")).toBe(
      true,
    );
  });
});

describe("Zcash wallet support", () => {
  const sapling = bech32Encode(
    "zs",
    Array.from({ length: 43 }, (_, i) => (i * 37) % 256),
    "bech32",
  );
  const unified = bech32Encode(
    "u",
    Array.from({ length: 128 }, (_, i) => (i * 53 + 7) % 256),
    "bech32m",
  );
  const unifiedRev2 = bech32Encode(
    "zu",
    Array.from({ length: 61 }, (_, i) => (i * 11 + 3) % 256),
    "bech32m",
  );

  it("accepts transparent t1 / t3 addresses as typed", () => {
    expect(
      validateWalletAddress("ZCASH", " t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs "),
    ).toEqual({ ok: true, normalized: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs" });
    expect(
      validateWalletAddress("ZCASH", "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd"),
    ).toEqual({ ok: true, normalized: "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd" });
  });

  it("accepts Sapling zs1 addresses and normalizes case", () => {
    expect(sapling).toHaveLength(78);
    expect(validateWalletAddress("ZCASH", sapling)).toEqual({
      ok: true,
      normalized: sapling,
    });
    expect(validateWalletAddress("ZCASH", sapling.toUpperCase())).toEqual({
      ok: true,
      normalized: sapling,
    });
  });

  it("accepts unified addresses past the 90-character bech32 limit", () => {
    expect(unified.length).toBeGreaterThan(200);
    expect(validateWalletAddress("ZCASH", unified)).toEqual({
      ok: true,
      normalized: unified,
    });
    expect(validateWalletAddress("ZCASH", unifiedRev2)).toEqual({
      ok: true,
      normalized: unifiedRev2,
    });
  });

  it("accepts the ZIP 320 TEX example", () => {
    const tex = "tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte";
    expect(validateWalletAddress("ZCASH", tex)).toEqual({
      ok: true,
      normalized: tex,
    });
  });

  it("rejects a shielded address with one character changed", () => {
    const damaged = `${sapling.slice(0, -1)}${sapling.endsWith("q") ? "p" : "q"}`;
    expect(validateWalletAddress("ZCASH", damaged).ok).toBe(false);
    const damagedUnified = `${unified.slice(0, 10)}${
      unified[10] === "q" ? "p" : "q"
    }${unified.slice(11)}`;
    expect(validateWalletAddress("ZCASH", damagedUnified).ok).toBe(false);
  });

  it("names retired Sprout addresses instead of a generic error", () => {
    const sprout = `zc${"A".repeat(93)}`;
    const result = validateWalletAddress("ZCASH", sprout);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Sprout/u);
  });

  it("rejects other chains' formats", () => {
    expect(validateWalletAddress("ZCASH", EVM_ADDRESS).ok).toBe(false);
    expect(
      validateWalletAddress("ZCASH", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")
        .ok,
    ).toBe(false);
    expect(validateWalletAddress("ZCASH", "t1short").ok).toBe(false);
    expect(validateWalletAddress("ZCASH", "").ok).toBe(false);
  });
});
