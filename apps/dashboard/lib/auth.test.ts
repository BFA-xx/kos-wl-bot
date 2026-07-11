import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
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
    mocks.findUnique.mockReset();
    mocks.updateMany.mockReset();
    mocks.refreshAccessToken.mockReset();
  });

  it("reuses a token persisted by a concurrent refresh", async () => {
    mocks.findUnique.mockResolvedValueOnce(expiredUser).mockResolvedValueOnce({
      accessToken: "new-access",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    mocks.refreshAccessToken.mockResolvedValue(null);

    await expect(getValidAccessToken("user-1")).resolves.toBe("new-access");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("updates rotated tokens only when the stored refresh token still matches", async () => {
    mocks.findUnique.mockResolvedValueOnce(expiredUser);
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "identify guilds",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(getValidAccessToken("user-1")).resolves.toBe("new-access");
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1", refreshToken: "old-refresh" },
      }),
    );
  });
});
