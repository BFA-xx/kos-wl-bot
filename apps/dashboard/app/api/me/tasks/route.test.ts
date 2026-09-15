import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  fetchMemberGuilds: vi.fn(),
  orgFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  raffleFindMany: vi.fn(),
  completionFindMany: vi.fn(),
  logFindMany: vi.fn(),
  ledgerGroupBy: vi.fn(),
  connectedFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    organization: { findMany: mocks.orgFindMany },
    taskDefinition: { findMany: mocks.taskFindMany },
    raffle: { findMany: mocks.raffleFindMany },
    taskCompletion: { findMany: mocks.completionFindMany },
    log: { findMany: mocks.logFindMany },
    pointsLedger: { groupBy: mocks.ledgerGroupBy },
    connectedAccount: { findUnique: mocks.connectedFindUnique },
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
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/member-guilds", () => ({
  fetchMemberGuilds: mocks.fetchMemberGuilds,
}));

import { GET } from "./route";

const kos = {
  id: "org-kos",
  slug: "kos",
  name: "KOS",
  logoUrl: null,
  guildConnections: [{ guildId: "guild-kos" }],
};
const prx = {
  id: "org-prx",
  slug: "prx",
  name: "PRX",
  logoUrl: null,
  guildConnections: [{ guildId: "guild-prx" }],
};

function hubRequest() {
  return new NextRequest("http://localhost/api/me/tasks");
}

describe("member tasks hub raffle scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1", username: "outis" });
    mocks.orgFindMany.mockResolvedValue([kos, prx]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.raffleFindMany.mockResolvedValue([]);
    mocks.completionFindMany.mockResolvedValue([]);
    mocks.logFindMany.mockResolvedValue([]);
    mocks.ledgerGroupBy.mockResolvedValue([]);
    mocks.connectedFindUnique.mockResolvedValue(null);
  });

  it("lists raffles from the member's communities plus any they entered", async () => {
    mocks.fetchMemberGuilds.mockResolvedValue({
      ok: true,
      guilds: [{ id: "guild-kos" }, { id: "guild-unrelated" }],
    });

    const res = await GET(hubRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.membershipKnown).toBe(true);
    expect(mocks.raffleFindMany).toHaveBeenCalledTimes(2);
    for (const status of ["LIVE", "ENDED"]) {
      expect(mocks.raffleFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            guildId: { in: ["guild-kos", "guild-prx"] },
            status,
            OR: [
              { guildId: { in: ["guild-kos"] } },
              { participants: { some: { userId: "user-1" } } },
            ],
          },
        }),
      );
    }
  });

  it("falls back to entered raffles and says so when Discord membership is unknown", async () => {
    mocks.fetchMemberGuilds.mockResolvedValue({ ok: false, guilds: [] });

    const res = await GET(hubRequest());
    const body = await res.json();

    expect(body.membershipKnown).toBe(false);
    expect(mocks.raffleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "LIVE",
          OR: [
            { guildId: { in: [] } },
            { participants: { some: { userId: "user-1" } } },
          ],
        }),
      }),
    );
  });

  it("still lists every community's standalone earning tasks", async () => {
    mocks.fetchMemberGuilds.mockResolvedValue({
      ok: true,
      guilds: [{ id: "guild-kos" }],
    });

    await GET(hubRequest());

    expect(mocks.taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: { in: ["org-kos", "org-prx"] },
        }),
      }),
    );
  });
});
