import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOrganization: vi.fn(),
  countMembers: vi.fn(),
  findMembers: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    organization: { findUnique: mocks.findOrganization },
    discordGuildMember: {
      count: mocks.countMembers,
      findMany: mocks.findMembers,
    },
    $transaction: mocks.transaction,
  },
}));

import { GET } from "./route";

const token = "sheets-test-token-that-is-longer-than-32-characters";

describe("Google Sheets Discord member feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHEETS_SYNC_TOKEN = token;
    mocks.findOrganization.mockResolvedValue({
      id: "org-a",
      slug: "alpha",
      name: "Alpha",
      suspendedAt: null,
      guildConnections: [{ guildId: "guild-a" }],
    });
    mocks.countMembers.mockReturnValue("count-query");
    mocks.findMembers.mockReturnValue("member-query");
    mocks.transaction.mockResolvedValue([
      2,
      [
        {
          guildId: "guild-a",
          userId: "user-a",
          username: "alpha_user",
          globalName: "Alpha User",
          nickname: null,
          displayName: "Alpha User",
          avatarUrl: null,
          joinedAt: null,
          firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-08-26T00:00:00.000Z"),
          leftAt: null,
          isActive: true,
          guild: { name: "Alpha Discord" },
        },
      ],
    ]);
  });

  it("rejects requests without the shared bearer token", async () => {
    const response = await GET(new Request("https://example.test/api"), {
      params: { org: "alpha" },
    });

    expect(response.status).toBe(401);
    expect(mocks.findOrganization).not.toHaveBeenCalled();
  });

  it("scopes records to verified guilds and paginates the feed", async () => {
    const response = await GET(
      new Request("https://example.test/api?page=2&limit=1&status=active", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: { org: "alpha" } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findOrganization).toHaveBeenCalledWith({
      where: { slug: "alpha" },
      select: expect.objectContaining({
        guildConnections: {
          where: { ownershipVerified: true },
          select: { guildId: true },
        },
      }),
    });
    expect(mocks.countMembers).toHaveBeenCalledWith({
      where: { guildId: { in: ["guild-a"] }, isActive: true },
    });
    expect(mocks.findMembers).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
    expect(body.members[0]).toMatchObject({
      userId: "user-a",
      guildName: "Alpha Discord",
      status: "Active",
    });
  });

  it("fails closed when the production token is missing or weak", async () => {
    process.env.SHEETS_SYNC_TOKEN = "short";
    const response = await GET(
      new Request("https://example.test/api", {
        headers: { authorization: "Bearer short" },
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(503);
  });
});
