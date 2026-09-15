import assert from "node:assert/strict";
import test from "node:test";
import { WalletChain } from "@kos/db";
import {
  ALL_CHAINS,
  EVM_CHAINS,
  EVM_FIELD_ID,
  chainLabel,
  validateWallet,
  verifyBech32,
  walletFamily,
} from "./wallets.js";

const EVM_ADDRESS = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
// ZIP 320's worked example — an independent check of the bech32m constant.
const TEX = "tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte";

test("the chain list covers every enum value and fits Discord's 25-entry cap", () => {
  assert.deepEqual(new Set(ALL_CHAINS), new Set(Object.values(WalletChain)));
  assert.ok(ALL_CHAINS.length <= 25, `${ALL_CHAINS.length} chains`);
  // /wallet set adds the EVM shortcut as a 25th-or-lower choice.
  assert.ok(ALL_CHAINS.length + 1 <= 25);
  assert.deepEqual(ALL_CHAINS.slice(0, 5), [
    WalletChain.ETHEREUM,
    WalletChain.BASE,
    WalletChain.ROBINHOOD,
    WalletChain.SOLANA,
    WalletChain.BITCOIN,
  ]);
  assert.ok(!ALL_CHAINS.includes(EVM_FIELD_ID as WalletChain));
});

test("every 0x chain is in the EVM family and validates with one rule", () => {
  for (const chain of [
    WalletChain.ETHEREUM,
    WalletChain.ROBINHOOD,
    WalletChain.ARC,
    WalletChain.INK,
    WalletChain.ABSTRACT,
    WalletChain.HYPEREVM,
    WalletChain.MONAD,
  ]) {
    assert.ok(EVM_CHAINS.includes(chain), chain);
  }
  for (const chain of EVM_CHAINS) {
    assert.equal(walletFamily(chain), "EVM");
    assert.deepEqual(validateWallet(chain, EVM_ADDRESS), {
      valid: true,
      normalized: EVM_ADDRESS.toLowerCase(),
    });
    assert.equal(validateWallet(chain, "0x1234").valid, false);
  }
  assert.ok(!EVM_CHAINS.includes(WalletChain.SOLANA));
  assert.ok(!EVM_CHAINS.includes(WalletChain.BITCOIN));
  assert.ok(!EVM_CHAINS.includes(WalletChain.ZCASH));
  assert.equal(chainLabel(WalletChain.ZCASH), "Zcash (ZEC)");
  assert.equal(chainLabel(WalletChain.ROBINHOOD), "Robinhood Chain (RH)");
});

test("bech32 checksums match the BIP 173 / BIP 350 vectors", () => {
  assert.equal(verifyBech32("a12uel5l", "bech32"), true);
  assert.equal(
    verifyBech32("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "bech32"),
    true,
  );
  assert.equal(verifyBech32("a1lqfn3a", "bech32m"), true);
  assert.equal(verifyBech32(TEX, "bech32m"), true);
  assert.equal(verifyBech32("a12uel5l", "bech32m"), false);
  assert.equal(verifyBech32("a12uel5x", "bech32"), false);
});

test("Zcash accepts transparent, Sapling, unified and TEX addresses", () => {
  assert.deepEqual(
    validateWallet(WalletChain.ZCASH, " t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs "),
    { valid: true, normalized: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs" },
  );
  assert.equal(
    validateWallet(WalletChain.ZCASH, "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd")
      .valid,
    true,
  );
  assert.deepEqual(validateWallet(WalletChain.ZCASH, TEX.toUpperCase()), {
    valid: true,
    normalized: TEX,
  });
  // Damage one character of the TEX address: the checksum must catch it.
  const damaged = `${TEX.slice(0, -1)}${TEX.endsWith("e") ? "q" : "e"}`;
  assert.equal(validateWallet(WalletChain.ZCASH, damaged).valid, false);
});

test("Zcash rejects other formats and names retired Sprout addresses", () => {
  assert.equal(validateWallet(WalletChain.ZCASH, EVM_ADDRESS).valid, false);
  assert.equal(validateWallet(WalletChain.ZCASH, "t1short").valid, false);
  assert.equal(validateWallet(WalletChain.ZCASH, "").valid, false);
  const sprout = validateWallet(WalletChain.ZCASH, `zc${"A".repeat(93)}`);
  assert.equal(sprout.valid, false);
  assert.match(sprout.error ?? "", /Sprout/u);
});

test("existing chains keep their rules", () => {
  assert.equal(
    validateWallet(WalletChain.SOLANA, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")
      .valid,
    true,
  );
  assert.equal(
    validateWallet(
      WalletChain.BITCOIN,
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    ).valid,
    true,
  );
  assert.equal(validateWallet(WalletChain.BITCOIN, EVM_ADDRESS).valid, false);
});
