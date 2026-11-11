import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  winners: vi.fn(),
  profiles: vi.fn(),
  usages: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    winner: { findMany: mocks.winners },
    walletProfile: { findMany: mocks.profiles },
    teamWalletUsage: { findMany: mocks.usages },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => value }));
vi.mock("@/lib/winner-wallet", () => ({
  selectConfiguredWallet: (wallet: unknown) => wallet,
}));
vi.mock("@/lib/wallet-validation", () => ({
  validateWalletAddress: (_chain: string, address: string) => ({
    ok: true,
    normalized: address.toLowerCase(),
  }),
}));
vi.mock("@/lib/team-wallet-pool", () => ({
  teamWalletAddressHash: (_chain: string, address: string) =>
    address.toLowerCase(),
  teamWalletChains: () => ["ETHEREUM"],
}));
import {
  communityRaffleWalletRows,
  raffleWalletExportRows,
} from "./raffle-wallet-export";
beforeEach(() => {
  mocks.winners.mockResolvedValue(
    [1, 2].map((id) => ({
      position: id,
      userId: `user-${id}`,
      username: `winner-${id}`,
      wallet: { chain: "ETHEREUM", address: "0xabc", submittedAt: new Date() },
    })),
  );
  mocks.profiles.mockResolvedValue([]);
  mocks.usages.mockResolvedValue([
    {
      reservedAt: new Date(),
      wallet: {
        address: "0xabc",
        addressHash: "0xabc",
        owner: { id: "team-user", username: "team", globalName: null },
      },
    },
  ]);
});
describe("duplicate addresses in exports", () => {
  it("retains every winner and team wallet row even when their addresses match", async () => {
    const rows = await raffleWalletExportRows(301, ["ETHEREUM"]);
    expect(rows.map((row) => row.userId)).toEqual([
      "user-1",
      "user-2",
      "team-user",
    ]);
    expect(rows.map((row) => row.address)).toEqual(["0xabc", "0xabc", "0xabc"]);
  });
  it("keeps deduplication for the community counts used to allocate team wallets", async () => {
    const rows = await communityRaffleWalletRows(301, ["ETHEREUM"]);
    expect(rows).toHaveLength(1);
  });
});
