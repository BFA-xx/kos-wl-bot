import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  lockedFindUnique: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: (value: string) => value,
  encryptSecret: (value: string) => `encrypted:${value}`,
}));

vi.mock("@/lib/discord-oauth", () => ({
  refreshAccessToken: mocks.refreshAccessToken,
}));

import { getValidAccessToken } from "./auth";

const expiredUser = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  tokenExpiresAt: new Date(Date.now() - 60_000),
};

describe("Discord access token refresh", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          $queryRaw: mocks.queryRaw,
          user: {
            findUnique: mocks.lockedFindUnique,
            update: mocks.update,
          },
        }),
    );
  });

  it("reuses a token persisted while waiting for the distributed lock", async () => {
    mocks.findUnique.mockResolvedValue(expiredUser);
    mocks.lockedFindUnique.mockResolvedValue({
      ...expiredUser,
      accessToken: "new-access",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });

    await expect(getValidAccessToken("user-1")).resolves.toBe("new-access");
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("rotates expired tokens while holding the distributed lock", async () => {
    mocks.findUnique.mockResolvedValue(expiredUser);
    mocks.lockedFindUnique.mockResolvedValue(expiredUser);
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "identify guilds",
    });
    mocks.update.mockResolvedValue({ id: "user-1" });

    await expect(getValidAccessToken("user-1")).resolves.toBe("new-access");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
  });

  it("rechecks storage when refresh rotation was already consumed", async () => {
    mocks.findUnique.mockResolvedValue(expiredUser);
    mocks.lockedFindUnique
      .mockResolvedValueOnce(expiredUser)
      .mockResolvedValueOnce({
        ...expiredUser,
        accessToken: "concurrent-access",
        tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      });
    mocks.refreshAccessToken.mockResolvedValue(null);

    await expect(getValidAccessToken("user-1")).resolves.toBe(
      "concurrent-access",
    );
    expect(mocks.lockedFindUnique).toHaveBeenCalledTimes(2);
  });
});
