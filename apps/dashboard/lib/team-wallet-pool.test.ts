import { describe, expect, it } from "vitest";
import {
  parseTeamWalletImport,
  selectTeamWallets,
  teamWalletAddressHash,
  type TeamWalletCandidate,
} from "./team-wallet-pool";

const at = new Date("2026-08-01T10:00:00.000Z");
const wallet = (
  id: string,
  ownerId: string,
  timesUsed = 0,
): TeamWalletCandidate => ({
  id,
  ownerId,
  addressHash: id,
  timesUsed,
  lastUsedAt: null,
  createdAt: at,
});

describe("Team Wallet Pool selection", () => {
  it("round-robins one wallet per member and skips exhausted members", () => {
    const result = selectTeamWallets({
      candidates: [
        wallet("a1", "a"),
        wallet("a2", "a"),
        wallet("b1", "b"),
        wallet("b2", "b"),
        wallet("c1", "c"),
      ],
      members: [
        { userId: "a", priority: 0 },
        { userId: "b", priority: 1 },
        { userId: "c", priority: 2 },
      ],
      needed: 5,
      mode: "ROUND_ROBIN",
    });
    expect(result.selected.map((item) => item.id)).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "b2",
    ]);
  });

  it("continues round robin after the previous fill's last owner", () => {
    const result = selectTeamWallets({
      candidates: [wallet("a1", "a"), wallet("b1", "b"), wallet("c1", "c")],
      members: [
        { userId: "a", priority: 0 },
        { userId: "b", priority: 1 },
        { userId: "c", priority: 2 },
      ],
      needed: 2,
      mode: "ROUND_ROBIN",
      lastSelectedOwnerId: "b",
    });
    expect(result.selected.map((item) => item.ownerId)).toEqual(["c", "a"]);
  });

  it("uses member priority order and least-used wallets in priority mode", () => {
    const result = selectTeamWallets({
      candidates: [
        wallet("a-used", "a", 4),
        wallet("a-fresh", "a"),
        wallet("b1", "b"),
      ],
      members: [
        { userId: "b", priority: 0 },
        { userId: "a", priority: 1 },
      ],
      needed: 3,
      mode: "PRIORITY",
    });
    expect(result.selected.map((item) => item.id)).toEqual([
      "b1",
      "a-fresh",
      "a-used",
    ]);
  });

  it("never returns the same wallet twice", () => {
    const duplicate = wallet("a1", "a");
    const result = selectTeamWallets({
      candidates: [duplicate, duplicate],
      members: [],
      needed: 2,
      mode: "ROUND_ROBIN",
    });
    expect(result.selected).toHaveLength(1);
  });
});

describe("Team Wallet Pool imports", () => {
  it("accepts CSV and pasted address lists with server-side validation", () => {
    const csv = parseTeamWalletImport(
      "chain,wallet_address\nethereum,0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "SOLANA",
    );
    expect(csv.errors).toEqual([]);
    expect(csv.rows[0]).toMatchObject({
      chain: "ETHEREUM",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const pasted = parseTeamWalletImport(
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      "BASE",
    );
    expect(pasted.rows).toHaveLength(2);
  });

  it("deduplicates the same EVM address across compatible chains", () => {
    expect(
      teamWalletAddressHash(
        "ETHEREUM",
        "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toBe(
      teamWalletAddressHash(
        "BASE",
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );
  });
});
