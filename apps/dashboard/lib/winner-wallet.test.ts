import { describe, expect, it } from "vitest";
import { selectConfiguredWallet } from "@/lib/winner-wallet";

describe("selectConfiguredWallet", () => {
  const solana = { id: "sol", chain: "SOLANA" };
  const robinhood = { id: "rh", chain: "ROBINHOOD" };

  it("uses a matching raffle-specific submission", () => {
    expect(selectConfiguredWallet(robinhood, [solana], ["ROBINHOOD"])).toBe(
      robinhood,
    );
  });

  it("ignores a mismatched submission and finds a matching profile", () => {
    expect(
      selectConfiguredWallet(solana, [solana, robinhood], ["ROBINHOOD"]),
    ).toBe(robinhood);
  });

  it("never substitutes Solana for a Robinhood raffle", () => {
    expect(selectConfiguredWallet(null, [solana], ["ROBINHOOD"])).toBeNull();
  });

  it("keeps legacy explicit submissions but does not guess a profile", () => {
    expect(selectConfiguredWallet(solana, [robinhood], [])).toBe(solana);
    expect(selectConfiguredWallet(null, [solana], [])).toBeNull();
  });
});
