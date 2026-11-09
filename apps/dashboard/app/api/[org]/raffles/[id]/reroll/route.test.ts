import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  logAudit: vi.fn(),
  findRaffle: vi.fn(),
  findWinner: vi.fn(),
  findEntrant: vi.fn(),
  findEntrants: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: { findFirst: mocks.findRaffle, updateMany: mocks.queue },
    winner: { findFirst: mocks.findWinner },
    participant: { findFirst: mocks.findEntrant, findMany: mocks.findEntrants },
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

import { AccessError } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { GET, POST } from "./route";

const context = { params: { org: "alpha", id: "60" } };
const url = "https://example.test/api/alpha/raffles/60/reroll";
const selection = {
  mode: "manual",
  winnerUserId: "current-winner",
  replacementUserId: "eligible-entrant",
};

function request(options: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(options) });
}

describe("dashboard raffle replacements", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "team-member" },
      guildIds: ["guild-a"],
    });
    mocks.findRaffle.mockResolvedValue({
      id: 60,
      guildId: "guild-a",
      status: "ENDED",
      holdResults: true,
      resultsPublishedAt: null,
    });
    mocks.findWinner.mockResolvedValue({ id: 2 });
    mocks.findEntrant.mockResolvedValue({ id: 3 });
    mocks.findEntrants.mockResolvedValue([
      { userId: "eligible-entrant", username: "Example" },
    ]);
    mocks.queue.mockResolvedValue({ count: 1 });
  });

  it("requires reroll permission before returning entrants", async () => {
    mocks.requireOrgAccess.mockRejectedValue(new AccessError(403, "Forbidden"));

    expect((await GET(new Request(url), context)).status).toBe(403);
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      PERMISSIONS.RAFFLE_REROLL,
    );
    expect(mocks.findEntrants).not.toHaveBeenCalled();
  });

  it("searches the raffle's entrants and excludes current winners and blacklisted users", async () => {
    const response = await GET(new Request(`${url}?q=example`), context);

    expect(response.status).toBe(200);
    expect(mocks.findRaffle).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 60, guildId: { in: ["guild-a"] } },
      }),
    );
    expect(mocks.findEntrants).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          raffleId: 60,
          user: {
            winners: { none: { raffleId: 60, replaced: false } },
            blacklists: { none: { guildId: "guild-a" } },
          },
          OR: [
            { username: { contains: "example", mode: "insensitive" } },
            { userId: "example" },
          ],
        },
        take: 201,
      }),
    );
    expect(await response.json()).toEqual({
      entrants: [{ userId: "eligible-entrant", username: "Example" }],
      truncated: false,
    });
  });

  it("flags a list that needs a search to see every entrant", async () => {
    mocks.findEntrants.mockResolvedValueOnce(
      Array.from({ length: 201 }, (_, i) => ({
        userId: String(i),
        username: `entrant${i}`,
      })),
    );

    const body = await (await GET(new Request(url), context)).json();
    expect(body.entrants).toHaveLength(200);
    expect(body.truncated).toBe(true);
  });

  it("queues the exact pair with the authenticated actor and guards against pending requests", async () => {
    const response = await POST(
      request({ ...selection, actorId: "spoofed" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.queue).toHaveBeenCalledWith({
      where: {
        id: 60,
        guildId: "guild-a",
        status: "ENDED",
        rerollRequestedAt: null,
        resultsPublishRequestedAt: null,
      },
      data: {
        rerollRequest: { ...selection, actorId: "team-member" },
        rerollRequestedAt: expect.any(Date),
      },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-a",
      "team-member",
      "RAFFLE_MANUAL_REROLL_REQUEST",
      expect.anything(),
    );

    mocks.queue.mockResolvedValue({ count: 0 });
    expect((await POST(request(selection), context)).status).toBe(409);
  });

  it("rejects incomplete, stale, and ineligible picks before queuing", async () => {
    expect((await POST(request({ mode: "manual" }), context)).status).toBe(400);
    mocks.findEntrant.mockResolvedValueOnce(null);
    expect((await POST(request(selection), context)).status).toBe(409);
    mocks.findWinner.mockResolvedValueOnce(null);
    expect((await POST(request(selection), context)).status).toBe(409);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("waits for a standard raffle's initial publication", async () => {
    mocks.findRaffle.mockResolvedValueOnce({
      id: 60,
      guildId: "guild-a",
      status: "ENDED",
      holdResults: false,
      resultsPublishedAt: null,
    });

    expect((await POST(request(selection), context)).status).toBe(409);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
