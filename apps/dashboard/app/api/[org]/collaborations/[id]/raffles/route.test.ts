import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  collaborationFindFirst: vi.fn(),
  raffleFindFirst: vi.fn(),
  linkFindUnique: vi.fn(),
  linkCreate: vi.fn(),
  collaborationUpdate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    collaboration: {
      findFirst: mocks.collaborationFindFirst,
      update: mocks.collaborationUpdate,
    },
    raffle: { findFirst: mocks.raffleFindFirst },
    collaborationRaffle: {
      findUnique: mocks.linkFindUnique,
      create: mocks.linkCreate,
    },
    collaborationActivity: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/access", () => ({
  requireOrgAccess: mocks.requireOrgAccess,
  withAccess:
    (
      handler: (
        req: Request,
        ctx: { params: Record<string, string> },
      ) => Promise<Response>,
    ) =>
    (req: Request, ctx: { params: Record<string, string> }) =>
      handler(req, ctx),
}));

vi.mock("@/lib/collab", () => ({ syncCollaborationState: mocks.sync }));

import { POST } from "./route";

describe("Collab Hub raffle linking", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: ["guild-a"],
    });
    mocks.collaborationFindFirst.mockResolvedValue({
      id: "collab-1",
      projectName: "KOS",
    });
    mocks.raffleFindFirst.mockResolvedValue({ id: 42, projectName: "KOS" });
    mocks.linkFindUnique.mockResolvedValue(null);
    mocks.linkCreate.mockResolvedValue({ id: "link-1" });
    mocks.collaborationUpdate.mockResolvedValue({ id: "collab-1" });
    mocks.activityCreate.mockResolvedValue({ id: "activity-1" });
    mocks.transaction.mockResolvedValue([]);
    mocks.sync.mockResolvedValue(undefined);
  });

  it("scopes an attached raffle through the organization's guild ids", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ raffleId: 42 }),
      }),
      { params: { org: "alpha", id: "collab-1" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.raffleFindFirst).toHaveBeenCalledWith({
      where: { id: 42, guildId: { in: ["guild-a"] } },
      select: { id: true, projectName: true },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith("collab-1", "org-a");
  });

  it("returns not found without writing when the raffle is outside the tenant", async () => {
    mocks.raffleFindFirst.mockResolvedValue(null);

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ raffleId: 42 }),
      }),
      { params: { org: "alpha", id: "collab-1" } },
    );

    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
