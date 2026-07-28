import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  guildFindUnique: vi.fn(),
  raidCreate: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    guild: { findUnique: mocks.guildFindUnique },
    raid: { create: mocks.raidCreate },
  },
}));

vi.mock("@/lib/access", () => ({
  AccessError: class AccessError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  requireOrgAccess: mocks.requireOrgAccess,
  logAudit: mocks.logAudit,
}));

import { POST } from "./route";

const guildId = "123456789012345678";
const defaultRaidChannelId = "123456789012345679";
const explicitRaidChannelId = "123456789012345680";
const validBody = {
  guildId,
  title: "Launch raid",
  tweetUrls: ["https://x.com/kos/status/100"],
  instructions: "Comment on the post",
  proofType: "AUTO",
  startAt: "2099-07-28T10:00:00.000Z",
  endAt: "2099-07-28T11:00:00.000Z",
  rewardRoleName: "Raid Winner",
};

describe("Raid creation channel defaults", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: [guildId],
    });
    mocks.guildFindUnique.mockResolvedValue({ defaultRaidChannelId });
    mocks.raidCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: "raid-a", status: data.status }),
    );
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it("uses the server's default Raid channel when the request omits one", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.guildFindUnique).toHaveBeenCalledWith({
      where: { id: guildId },
      select: { defaultRaidChannelId: true },
    });
    expect(mocks.raidCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guildId,
        channelId: defaultRaidChannelId,
      }),
    });
  });

  it("keeps a manager's per-Raid channel override", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          ...validBody,
          channelId: explicitRaidChannelId,
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.guildFindUnique).not.toHaveBeenCalled();
    expect(mocks.raidCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ channelId: explicitRaidChannelId }),
    });
  });
});
