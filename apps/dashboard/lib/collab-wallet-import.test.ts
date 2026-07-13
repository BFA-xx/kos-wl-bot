import { describe, expect, it } from "vitest";
import { parseWalletImport } from "./collab-wallet-import";

describe("parseWalletImport", () => {
  it("parses a headered CSV and normalizes addresses", () => {
    const result = parseWalletImport(
      "discord_id,chain,wallet_address\n123456,ethereum,0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "SOLANA",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        row: 2,
        userId: "123456",
        chain: "ETHEREUM",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ]);
  });

  it("supports two-column lists with a default chain", () => {
    const result = parseWalletImport(
      "123456,0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "BASE",
    );
    expect(result.rows[0]).toMatchObject({ userId: "123456", chain: "BASE" });
  });

  it("rejects conflicting duplicate rows without exposing the address", () => {
    const result = parseWalletImport(
      [
        "123456,0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "123456,0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      ].join("\n"),
      "ETHEREUM",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]?.error).toContain("different addresses");
    expect(result.errors[0]?.error).not.toContain("0x");
  });
});
