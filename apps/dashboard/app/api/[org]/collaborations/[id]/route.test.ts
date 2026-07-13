import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  logAudit: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    collaboration: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/access", () => ({
  requireOrgAccess: mocks.requireOrgAccess,
  logAudit: mocks.logAudit,
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

import { DELETE } from "./route";

describe("Collab Hub tenant isolation", () => {
  beforeEach(() => {
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: ["guild-a"],
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it("archives only a collaboration owned by the resolved organization", async () => {
    const response = await DELETE(new Request("https://example.test"), {
      params: { org: "alpha", id: "collab-1" },
    });

    expect(response.status).toBe(200);
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      "collab:archive",
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "collab-1",
        organizationId: "org-a",
        archivedAt: null,
      },
      data: expect.objectContaining({ archivedAt: expect.any(Date) }),
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-a",
      "user-a",
      "COLLABORATION_ARCHIVE",
      expect.objectContaining({ targetId: "collab-1" }),
    );
  });

  it("does not reveal whether another tenant owns the requested id", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await DELETE(new Request("https://example.test"), {
      params: { org: "alpha", id: "collab-from-org-b" },
    });

    expect(response.status).toBe(404);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
