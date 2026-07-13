import test from "node:test";
import assert from "node:assert/strict";
import { WalletChain } from "@kos/db";
import { ALL_CHAINS, chainLabel, validateWallet } from "../utils/wallets.js";

test("Robinhood Chain is available to Discord raffle and wallet flows", () => {
  assert.ok(ALL_CHAINS.includes(WalletChain.ROBINHOOD));
  assert.equal(chainLabel(WalletChain.ROBINHOOD), "Robinhood Chain (RH)");
});

test("Robinhood Chain validates and normalizes EVM addresses", () => {
  const result = validateWallet(
    WalletChain.ROBINHOOD,
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  assert.deepEqual(result, {
    valid: true,
    normalized: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(validateWallet(WalletChain.ROBINHOOD, "RH123").valid, false);
});
