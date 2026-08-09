import { describe, expect, it, vi } from "vitest";
import {
  canManageAllTeamWallets,
  effectiveTeamWalletStatus,
  eligibleTeamWallets,
} from "./team-wallet-server";
import { teamWalletAddressHash } from "./team-wallet-pool";

const access = (isOwner: boolean, roleName: string | null) =>
  ({
    isOwner,
    member: roleName ? { role: { name: roleName } } : null,
  }) as Parameters<typeof canManageAllTeamWallets>[0];

describe("Team Wallet Pool management permissions", () => {
  it("allows owners and Admins to manage every team member's wallets", () => {
    expect(canManageAllTeamWallets(access(true, null))).toBe(true);
    expect(canManageAllTeamWallets(access(false, "Admin"))).toBe(true);
  });

  it("keeps Collab Managers and regular members owner-scoped", () => {
    expect(canManageAllTeamWallets(access(false, "Collab Manager"))).toBe(
      false,
    );
    expect(canManageAllTeamWallets(access(false, "Viewer"))).toBe(false);
  });
});

describe("Team Wallet Pool eligibility", () => {
  it("includes valid wallets from every owner and ignores ended-raffle stored status", async () => {
    const createdAt = new Date("2026-08-01T08:00:00.000Z");
    const updatedAt = new Date("2026-08-09T08:00:00.000Z");
    const first = "0x1111111111111111111111111111111111111111";
    const second = "0x2222222222222222222222222222222222222222";
    const community = "0x3333333333333333333333333333333333333333";
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "wallet-a",
        ownerId: "member-a",
        owner: { username: "member-a", globalName: "Member A" },
        chain: "ETHEREUM",
        chains: ["ETHEREUM", "ROBINHOOD"],
        address: first,
        addressHash: teamWalletAddressHash("ETHEREUM", first),
        timesUsed: 4,
        lastUsedAt: createdAt,
        createdAt,
        updatedAt,
      },
      {
        id: "wallet-b",
        ownerId: "member-b",
        owner: { username: "member-b", globalName: "Member B" },
        chain: "ETHEREUM",
        chains: ["ETHEREUM"],
        address: second,
        addressHash: teamWalletAddressHash("ETHEREUM", second),
        timesUsed: 0,
        lastUsedAt: null,
        createdAt,
        updatedAt,
      },
      {
        id: "community-duplicate",
        ownerId: "member-c",
        owner: { username: "member-c", globalName: null },
        chain: "ETHEREUM",
        chains: ["ETHEREUM"],
        address: community,
        addressHash: teamWalletAddressHash("ETHEREUM", community),
        timesUsed: 0,
        lastUsedAt: null,
        createdAt,
        updatedAt,
      },
      {
        id: "invalid",
        ownerId: "member-d",
        owner: { username: "member-d", globalName: null },
        chain: "ETHEREUM",
        chains: ["ETHEREUM"],
        address: "not-a-wallet",
        addressHash: "invalid",
        timesUsed: 0,
        lastUsedAt: null,
        createdAt,
        updatedAt,
      },
    ]);

    const result = await eligibleTeamWallets({
      poolId: "pool-a",
      raffleId: 110,
      walletChains: ["ETHEREUM"],
      communityAddressHashes: [teamWalletAddressHash("ETHEREUM", community)],
      db: { teamWallet: { findMany } } as never,
    });

    expect(result.map((wallet) => wallet.ownerName)).toEqual([
      "Member A",
      "Member B",
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          poolId: "pool-a",
          status: { not: "DISABLED" },
          usages: {
            none: {
              OR: [
                { raffleId: 110 },
                {
                  status: "RESERVED",
                  raffle: {
                    status: { in: ["DRAFT", "UPCOMING", "LIVE"] },
                  },
                },
              ],
            },
          },
        }),
      }),
    );
  });

  it("derives pool availability from active reservations, not ended history", () => {
    expect(effectiveTeamWalletStatus("RESERVED", 0)).toBe("AVAILABLE");
    expect(effectiveTeamWalletStatus("AVAILABLE", 1)).toBe("RESERVED");
    expect(effectiveTeamWalletStatus("DISABLED", 0)).toBe("DISABLED");
  });
});
