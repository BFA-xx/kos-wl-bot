import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  requireOrgAccess: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: { findFirst: mocks.findFirst },
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

import { GET } from "./route";

describe("duplicate raffle tenant isolation", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: ["guild-a"],
    });
    mocks.findFirst.mockResolvedValue(null);
  });

  it("cannot read a raffle outside the requesting organization's guilds", async () => {
    const response = await GET(
      new NextRequest("https://raffle.koslabs.app/api/alpha/raffles/42/duplicate"),
      { params: { org: "alpha", id: "42" } },
    );

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42, guildId: { in: ["guild-a"] } },
      }),
    );
  });

  it("rejects malformed ids before querying tenant data", async () => {
    const response = await GET(
      new NextRequest("https://raffle.koslabs.app/api/alpha/raffles/nope/duplicate"),
      { params: { org: "alpha", id: "nope" } },
    );

    expect(response.status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
