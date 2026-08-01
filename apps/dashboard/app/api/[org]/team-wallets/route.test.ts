import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  logAudit: vi.fn(),
  ensurePool: vi.fn(),
  teamMembers: vi.fn(),
  canManageAll: vi.fn(),
  transaction: vi.fn(),
  walletFindMany: vi.fn(),
  seatCount: vi.fn(),
  seatUpsert: vi.fn(),
  walletUpdate: vi.fn(),
  walletCreateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: mocks.transaction },
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
  organizationTeamMembers: mocks.teamMembers,
  canManageAllTeamWallets: mocks.canManageAll,
}));

vi.mock("@/lib/crypto", () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  decryptSecret: (value: string) => value,
}));

import { POST } from "./route";

const address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function request(body: object) {
  return new Request("https://example.test/api/alpha/team-wallets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Team Wallet Pool multi-chain imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a", ownerId: "owner-a" },
      user: { id: "user-a" },
    });
    mocks.canManageAll.mockReturnValue(false);
    mocks.teamMembers.mockResolvedValue([
      { userId: "user-a", name: "Member A" },
    ]);
    mocks.ensurePool.mockResolvedValue({ id: "pool-a" });
    mocks.walletFindMany.mockResolvedValue([]);
    mocks.seatCount.mockResolvedValue(0);
    mocks.seatUpsert.mockResolvedValue({});
    mocks.walletUpdate.mockResolvedValue({});
    mocks.walletCreateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(
      async (handler: (tx: unknown) => Promise<unknown>) =>
        handler({
          teamWallet: {
            findMany: mocks.walletFindMany,
            update: mocks.walletUpdate,
            createMany: mocks.walletCreateMany,
          },
          teamWalletPoolMember: {
            count: mocks.seatCount,
            upsert: mocks.seatUpsert,
          },
        }),
    );
  });

  it("creates one wallet record covering every selected compatible chain", async () => {
    const response = await POST(
      request({
        content: address,
        chains: ["ETHEREUM", "BASE", "ROBINHOOD"],
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      imported: 1,
      updated: 0,
    });
    expect(mocks.walletCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          chain: "ETHEREUM",
          chains: ["ETHEREUM", "BASE", "ROBINHOOD"],
          address: `encrypted:${address.toLowerCase()}`,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("expands the chain set on an existing wallet owned by the same member", async () => {
    mocks.walletFindMany.mockImplementationOnce(async (query) => {
      const hash = query.where.addressHash.in[0];
      return [
        {
          id: "wallet-a",
          poolId: "pool-a",
          ownerId: "user-a",
          chain: "ETHEREUM",
          chains: ["ETHEREUM"],
          addressHash: hash,
          deletedAt: null,
        },
      ];
    });

    const response = await POST(
      request({ content: address, chains: ["ETHEREUM", "BASE"] }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      imported: 0,
      updated: 1,
    });
    expect(mocks.walletUpdate).toHaveBeenCalledWith({
      where: { id: "wallet-a" },
      data: { chains: ["ETHEREUM", "BASE"] },
    });
    expect(mocks.walletCreateMany).not.toHaveBeenCalled();
  });

  it("does not expand a globally duplicated wallet owned elsewhere", async () => {
    mocks.walletFindMany.mockImplementationOnce(async (query) => {
      const hash = query.where.addressHash.in[0];
      return [
        {
          id: "wallet-other",
          poolId: "pool-other",
          ownerId: "user-other",
          chain: "ETHEREUM",
          chains: ["ETHEREUM"],
          addressHash: hash,
          deletedAt: null,
        },
      ];
    });

    const response = await POST(
      request({ content: address, chains: ["ETHEREUM", "BASE"] }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      imported: 0,
      updated: 0,
      errors: [
        { error: "This wallet already exists in a Team Wallet Pool." },
      ],
    });
    expect(mocks.walletUpdate).not.toHaveBeenCalled();
    expect(mocks.walletCreateMany).not.toHaveBeenCalled();
  });
});
