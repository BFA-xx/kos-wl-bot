import { describe, expect, it } from "vitest";
import {
  isWalletChain,
  validateWalletAddress,
  walletChainLabel,
} from "./wallet-validation";

describe("Robinhood Chain wallet support", () => {
  it("recognizes Robinhood as a selectable wallet chain", () => {
    expect(isWalletChain("ROBINHOOD")).toBe(true);
    expect(walletChainLabel("ROBINHOOD")).toBe("Robinhood Chain (RH)");
  });

  it("uses EVM address validation and lowercase normalization", () => {
    expect(
      validateWalletAddress(
        "ROBINHOOD",
        "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toEqual({
      ok: true,
      normalized: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(validateWalletAddress("ROBINHOOD", "RH123").ok).toBe(false);
  });
});
