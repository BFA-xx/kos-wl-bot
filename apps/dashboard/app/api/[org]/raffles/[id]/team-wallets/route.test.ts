import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  raffleFindFirst: vi.fn(),
  usageCount: vi.fn(),
  walletCount: vi.fn(),
  ensurePool: vi.fn(),
  communityRows: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: { findFirst: mocks.raffleFindFirst },
    teamWalletUsage: { count: mocks.usageCount },
    teamWallet: { count: mocks.walletCount },
  },
}));

vi.mock("@/lib/access", () => ({
  requireOrgAccess: mocks.requireOrgAccess,
  logAudit: vi.fn(),
  withAccess:
    (handler: (request: Request, context: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(request, context),
}));

vi.mock("@/lib/team-wallet-server", () => ({
  ensureDefaultTeamWalletPool: mocks.ensurePool,
}));

vi.mock("@/lib/raffle-wallet-export", () => ({
  communityRaffleWalletRows: mocks.communityRows,
}));

import { GET } from "./route";
import { PERMISSIONS } from "@/lib/permissions";

describe("Team Wallet Pool raffle preview", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      guildIds: ["guild-a"],
    });
    mocks.raffleFindFirst.mockResolvedValue({
      id: 60,
      projectName: "KOS Project",
      title: "FCFS",
      status: "ENDED",
      spots: 60,
      walletChains: ["ETHEREUM"],
    });
    mocks.ensurePool.mockResolvedValue({
      id: "pool-a",
      selectionMode: "ROUND_ROBIN",
    });
    mocks.communityRows.mockResolvedValue(
      Array.from({ length: 28 }, (_, index) => ({
        addressHash: `community-${index}`,
      })),
    );
    mocks.usageCount.mockResolvedValue(0);
    mocks.walletCount.mockResolvedValue(40);
  });

  it("calculates the requested/community/remaining confirmation counts", async () => {
    const response = await GET(new Request("https://example.test"), {
      params: { org: "alpha", id: "60" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requiredWallets: 60,
      communityWallets: 28,
      remainingWalletsNeeded: 32,
      availableWallets: 40,
      selectionMode: "ROUND_ROBIN",
    });
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      PERMISSIONS.TEAM_WALLET_FILL,
    );
    expect(mocks.raffleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 60, guildId: { in: ["guild-a"] } },
      }),
    );
    expect(mocks.walletCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        poolId: "pool-a",
        status: "AVAILABLE",
        chain: { in: ["ETHEREUM"] },
        addressHash: {
          notIn: expect.arrayContaining(["community-0", "community-27"]),
        },
      }),
    });
  });

  it("rejects a raffle that has not ended", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      id: 60,
      projectName: "KOS Project",
      title: "FCFS",
      status: "LIVE",
      spots: 60,
      walletChains: ["ETHEREUM"],
    });

    const response = await GET(new Request("https://example.test"), {
      params: { org: "alpha", id: "60" },
    });
    expect(response.status).toBe(409);
    expect(mocks.ensurePool).not.toHaveBeenCalled();
  });
});
