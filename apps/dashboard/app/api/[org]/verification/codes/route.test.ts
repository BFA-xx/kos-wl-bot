import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  create: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { verificationCode: { create: mocks.create } },
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

describe("verification dashboard code creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: [guildId],
    });
    mocks.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "code-a", uses: 0, ...data }),
    );
    mocks.logAudit.mockResolvedValue(undefined);
  });

  it("normalizes and stores a guild-scoped role-granting code", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          guildId,
          code: " alpha ",
          description: "Alpha access",
          roleIds: ["123456789012345679"],
          maxUses: 50,
          expiresAt: null,
          active: true,
          oneTimePerMember: true,
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        guildId,
        code: "ALPHA",
        description: "Alpha access",
        roleIds: ["123456789012345679"],
        maxUses: 50,
        expiresAt: null,
        active: true,
        oneTimePerMember: true,
        createdById: "user-a",
      },
    });
  });

  it("rejects a guild outside the organization scope", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          guildId: "999999999999999999",
          code: "ALPHA",
          roleIds: [],
          active: true,
          oneTimePerMember: true,
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
