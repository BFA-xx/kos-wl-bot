import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  logFindFirst: vi.fn(),
  transaction: vi.fn(),
  raffleUpdate: vi.fn(),
  logCreate: vi.fn(),
  requireOrgAccess: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: {
      findFirst: mocks.findFirst,
    },
    log: { findFirst: mocks.logFindFirst },
    $transaction: mocks.transaction,
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

import { DELETE } from "./route";

const raffle = {
  id: 60,
  guildId: "guild-a",
  projectName: "NUTSY",
  title: "FCFS",
  status: "LIVE",
  channelId: null,
  messageId: null,
};

describe("dashboard raffle deletion", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: ["guild-a"],
    });
    mocks.findFirst.mockResolvedValue(raffle);
    mocks.logFindFirst.mockResolvedValue(null);
    mocks.raffleUpdate.mockResolvedValue(raffle);
    mocks.logCreate.mockResolvedValue({ id: 1 });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        raffle: { update: mocks.raffleUpdate },
        log: { create: mocks.logCreate },
      }),
    );
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it("scopes the raffle lookup to the requesting organization", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await DELETE(new Request("https://example.test"), {
      params: { org: "alpha", id: "60" },
    });

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 60, guildId: { in: ["guild-a"] } },
      }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cancels the raffle and queues bot-owned cleanup", async () => {
    const response = await DELETE(new Request("https://example.test"), {
      params: { org: "alpha", id: "60" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ queued: true });
    expect(mocks.raffleUpdate).toHaveBeenCalledWith({
      where: { id: 60 },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(mocks.logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        raffleId: 60,
        action: "RAFFLE_DELETE_REQUEST",
      }),
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-a",
      "user-a",
      "RAFFLE_DELETE_REQUEST",
      expect.objectContaining({ targetId: "60" }),
    );
  });

  it("treats an existing delete request as idempotently queued", async () => {
    mocks.logFindFirst.mockResolvedValue({ id: 7 });

    const response = await DELETE(new Request("https://example.test"), {
      params: { org: "alpha", id: "60" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ queued: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
