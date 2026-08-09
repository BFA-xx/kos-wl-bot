import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  raffleFindFirst: vi.fn(),
  usageCount: vi.fn(),
  memberFindMany: vi.fn(),
  ensurePool: vi.fn(),
  communityRows: vi.fn(),
  eligibleWallets: vi.fn(),
  transaction: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: { findFirst: mocks.raffleFindFirst },
    teamWalletUsage: { count: mocks.usageCount },
    teamWalletPoolMember: { findMany: mocks.memberFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/access", () => ({
  requireOrgAccess: mocks.requireOrgAccess,
  logAudit: mocks.logAudit,
  withAccess:
    (handler: (request: Request, context: unknown) => Promise<Response>) =>
    (request: Request, context: unknown) =>
      handler(request, context),
}));

vi.mock("@/lib/team-wallet-server", () => ({
  ensureDefaultTeamWalletPool: mocks.ensurePool,
  eligibleTeamWallets: mocks.eligibleWallets,
}));

vi.mock("@/lib/raffle-wallet-export", () => ({
  communityRaffleWalletRows: mocks.communityRows,
}));

import { GET, POST } from "./route";
import { PERMISSIONS } from "@/lib/permissions";

const at = new Date("2026-08-09T08:00:00.000Z");
const candidate = (index: number, ownerId: string) => ({
  id: `wallet-${index}`,
  ownerId,
  ownerName: `Member ${ownerId.toUpperCase()}`,
  address: `0x${index.toString(16).padStart(40, "0")}`,
  addressHash: `hash-${index}`,
  chain: "ETHEREUM" as const,
  timesUsed: 0,
  lastUsedAt: null,
  createdAt: at,
  updatedAt: at,
});

describe("Team Wallet Pool raffle preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      guildIds: ["guild-a"],
    });
    mocks.raffleFindFirst.mockResolvedValue({
      id: 110,
      projectName: "9toDino",
      title: "FCFS",
      status: "ENDED",
      spots: 30,
      walletChains: ["ETHEREUM"],
    });
    mocks.ensurePool.mockResolvedValue({
      id: "pool-a",
      selectionMode: "ROUND_ROBIN",
      lastSelectedOwnerId: null,
    });
    mocks.communityRows.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        addressHash: `community-${index}`,
      })),
    );
    mocks.usageCount.mockResolvedValue(0);
    mocks.memberFindMany.mockResolvedValue([
      { userId: "a", priority: 0 },
      { userId: "b", priority: 1 },
      { userId: "c", priority: 2 },
    ]);
    mocks.eligibleWallets.mockResolvedValue(
      Array.from({ length: 42 }, (_, index) =>
        candidate(index + 1, ["a", "b", "c"][index % 3]!),
      ),
    );
  });

  it("defaults to the full remainder and previews round robin across members", async () => {
    const response = await GET(new Request("https://example.test"), {
      params: { org: "alpha", id: "110" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      requiredWallets: 30,
      communityWallets: 12,
      remainingWalletsNeeded: 18,
      availableWallets: 42,
      maxSelectable: 18,
      selectedCount: 18,
      selectionMode: "ROUND_ROBIN",
    });
    expect(
      body.selectedWallets
        .slice(0, 6)
        .map((wallet: { ownerId: string }) => wallet.ownerId),
    ).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      PERMISSIONS.TEAM_WALLET_FILL,
    );
    expect(mocks.eligibleWallets).toHaveBeenCalledWith({
      poolId: "pool-a",
      raffleId: 110,
      walletChains: ["ETHEREUM"],
      communityAddressHashes: expect.arrayContaining([
        "community-0",
        "community-11",
      ]),
    });
  });

  it("lets a CM reduce the requested fill to 15 without changing availability", async () => {
    const response = await GET(
      new Request("https://example.test?count=15&selectionMode=ROUND_ROBIN"),
      { params: { org: "alpha", id: "110" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      remainingWalletsNeeded: 18,
      availableWallets: 42,
      maxSelectable: 18,
      selectedCount: 15,
      selectedWallets: expect.arrayContaining([
        expect.objectContaining({ ownerName: "Member A" }),
        expect.objectContaining({ ownerName: "Member B" }),
        expect.objectContaining({ ownerName: "Member C" }),
      ]),
    });
  });

  it("caps selection at eligible availability with a clear conflict", async () => {
    mocks.eligibleWallets.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => candidate(index + 1, "a")),
    );
    const response = await GET(new Request("https://example.test?count=11"), {
      params: { org: "alpha", id: "110" },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Only 10 team wallets are selectable right now.",
    });
  });

  it("rejects a raffle that has not ended", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      id: 110,
      projectName: "9toDino",
      title: "FCFS",
      status: "LIVE",
      spots: 30,
      walletChains: ["ETHEREUM"],
    });

    const response = await GET(new Request("https://example.test"), {
      params: { org: "alpha", id: "110" },
    });
    expect(response.status).toBe(409);
    expect(mocks.ensurePool).not.toHaveBeenCalled();
  });
});

describe("Team Wallet Pool raffle reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "cm-a" },
      guildIds: ["guild-a"],
    });
    mocks.ensurePool.mockResolvedValue({ id: "pool-a" });
    mocks.communityRows.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        addressHash: `community-${index}`,
      })),
    );
    mocks.eligibleWallets.mockResolvedValue(
      Array.from({ length: 42 }, (_, index) =>
        candidate(index + 1, ["a", "b", "c"][index % 3]!),
      ),
    );
  });

  function transactionClient(updated = 15) {
    const tx = {
      raffle: {
        findFirst: vi.fn().mockResolvedValue({
          id: 110,
          projectName: "9toDino",
          status: "ENDED",
          spots: 30,
          walletChains: ["ETHEREUM"],
        }),
      },
      teamWalletPool: {
        findUnique: vi.fn().mockResolvedValue({
          id: "pool-a",
          selectionMode: "ROUND_ROBIN",
          lastSelectedOwnerId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      teamWalletUsage: {
        count: vi.fn().mockResolvedValue(0),
        createMany: vi.fn().mockResolvedValue({ count: updated }),
      },
      raffleTeamWalletFill: {
        create: vi.fn().mockResolvedValue({ id: "fill-a" }),
      },
      teamWallet: {
        updateMany: vi.fn().mockResolvedValue({ count: updated }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    return tx;
  }

  it("reserves exactly 15, preserves three unfilled slots, and writes only those usages", async () => {
    const tx = transactionClient();
    const wallets = Array.from({ length: 15 }, (_, index) => ({
      id: `wallet-${index + 1}`,
      version: at.toISOString(),
    }));
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          selectionMode: "ROUND_ROBIN",
          count: 15,
          wallets,
        }),
      }),
      { params: { org: "alpha", id: "110" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selected: 15,
      remaining: 3,
      selectionMode: "ROUND_ROBIN",
    });
    expect(tx.raffleTeamWalletFill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requiredWallets: 30,
        communityWallets: 12,
        selectedWallets: 15,
      }),
    });
    expect(tx.teamWallet.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: wallets.map((wallet) => wallet.id) },
      }),
      data: expect.objectContaining({ status: "RESERVED" }),
    });
    expect(tx.teamWalletUsage.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          walletId: "wallet-1",
          raffleId: 110,
          fillId: "fill-a",
        }),
        expect.objectContaining({ walletId: "wallet-15" }),
      ]),
    });
    expect(tx.teamWalletUsage.createMany.mock.calls[0]![0].data).toHaveLength(
      15,
    );
  });

  it("rejects a stale concurrent preview before creating a fill", async () => {
    const tx = transactionClient();
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          selectionMode: "ROUND_ROBIN",
          count: 1,
          wallets: [{ id: "wallet-1", version: "2026-08-09T07:00:00.000Z" }],
        }),
      }),
      { params: { org: "alpha", id: "110" } },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Wallet availability changed after this preview. Regenerate the selection and confirm again.",
    });
    expect(tx.raffleTeamWalletFill.create).not.toHaveBeenCalled();
    expect(tx.teamWallet.updateMany).not.toHaveBeenCalled();
  });
});
