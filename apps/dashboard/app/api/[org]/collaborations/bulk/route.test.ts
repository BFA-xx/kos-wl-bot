import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  memberFindFirst: vi.fn(),
  logAudit: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    collaboration: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
    organizationMember: { findFirst: mocks.memberFindFirst },
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

vi.mock("@vercel/blob", () => ({ del: mocks.del }));

import { PATCH } from "./route";

describe("Collab Hub spreadsheet bulk actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
    });
    mocks.memberFindFirst.mockResolvedValue({ id: "member-1" });
    mocks.updateMany.mockResolvedValue({ count: 2 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.findMany.mockResolvedValue([
      { id: "collab-1", attachments: [{ url: "blob://document" }] },
    ]);
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.del.mockResolvedValue(undefined);
  });

  it("assigns only active organization members to organization-owned rows", async () => {
    const response = await PATCH(
      new Request("https://example.test", {
        method: "PATCH",
        body: JSON.stringify({
          ids: ["collab-1", "collab-2"],
          action: "assign",
          assignedToId: "host-1",
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      "collab:assign",
    );
    expect(mocks.memberFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        userId: "host-1",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["collab-1", "collab-2"] },
        organizationId: "org-a",
      },
      data: expect.objectContaining({ assignedToId: "host-1" }),
    });
  });

  it("permanently deletes only resolved organization rows and their files", async () => {
    const response = await PATCH(
      new Request("https://example.test", {
        method: "PATCH",
        body: JSON.stringify({ ids: ["collab-1"], action: "delete" }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireOrgAccess).toHaveBeenCalledWith(
      "alpha",
      "collab:archive",
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["collab-1"] }, organizationId: "org-a" },
      select: { id: true, attachments: { select: { url: true } } },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["collab-1"] } },
    });
    expect(mocks.del).toHaveBeenCalledWith("blob://document");
  });
});
