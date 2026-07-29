import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAccess: vi.fn(),
  settingsFindUnique: vi.fn(),
  settingsUpsert: vi.fn(),
  codeFindMany: vi.fn(),
  logFindMany: vi.fn(),
  logCount: vi.fn(),
  memberCount: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    verificationSettings: {
      findUnique: mocks.settingsFindUnique,
      upsert: mocks.settingsUpsert,
    },
    verificationCode: { findMany: mocks.codeFindMany },
    verificationLog: {
      findMany: mocks.logFindMany,
      count: mocks.logCount,
    },
    memberVerification: { count: mocks.memberCount },
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

import { GET, PATCH } from "./route";

const guildId = "123456789012345678";

describe("verification dashboard settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgAccess.mockResolvedValue({
      org: { id: "org-a" },
      user: { id: "user-a" },
      guildIds: [guildId],
    });
    mocks.settingsFindUnique.mockResolvedValue(null);
    mocks.codeFindMany.mockResolvedValue([]);
    mocks.logFindMany.mockResolvedValue([]);
    mocks.logCount.mockResolvedValue(0);
    mocks.memberCount.mockResolvedValue(0);
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.settingsUpsert.mockImplementation(({ create }) =>
      Promise.resolve({
        ...create,
        enabled: false,
        controlRequestId: "queued",
      }),
    );
  });

  it("returns server-scoped settings, codes, activity, and totals", async () => {
    const response = await GET(
      new Request(`https://example.test?guildId=${guildId}`),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.settingsFindUnique).toHaveBeenCalledWith({
      where: { guildId },
    });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          guildId,
          welcomeTitle: "Welcome to KOS.",
        }),
        codes: [],
        logs: [],
        stats: { verifiedMembers: 0, successes: 0, failures: 0 },
      }),
    );
  });

  it("queues bot-owned Discord actions with a revision id", async () => {
    const response = await PATCH(
      new Request("https://example.test", {
        method: "PATCH",
        body: JSON.stringify({
          guildId,
          verificationChannelId: "123456789012345679",
          welcomeTitle: "KOS Access",
          desiredEnabled: true,
          syncAccess: true,
          publishPanel: true,
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.settingsUpsert).toHaveBeenCalledWith({
      where: { guildId },
      create: expect.objectContaining({
        guildId,
        welcomeTitle: "KOS Access",
        desiredEnabled: true,
        accessSyncRequested: true,
        panelPublishRequested: true,
        controlRequestId: expect.any(String),
        controlRequestedById: "user-a",
      }),
      update: expect.objectContaining({
        welcomeTitle: "KOS Access",
        desiredEnabled: true,
        accessSyncRequested: true,
        panelPublishRequested: true,
        controlRequestId: expect.any(String),
      }),
    });
    expect(mocks.logAudit).toHaveBeenCalled();
  });

  it("clears the old Unverified overwrite when a live role changes", async () => {
    mocks.settingsFindUnique.mockResolvedValue({
      enabled: true,
      verificationChannelId: "123456789012345679",
      rulesChannelId: null,
      unverifiedRoleId: "123456789012345680",
      allowedChannelIds: [],
      accessCleanupRoleIds: [],
    });

    const response = await PATCH(
      new Request("https://example.test", {
        method: "PATCH",
        body: JSON.stringify({
          guildId,
          unverifiedRoleId: "123456789012345681",
        }),
      }),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.settingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          accessSyncRequested: true,
          accessCleanupRoleIds: {
            set: ["123456789012345680"],
          },
          controlRequestId: expect.any(String),
        }),
      }),
    );
  });

  it("does not allow one organization to address another server", async () => {
    const response = await GET(
      new Request("https://example.test?guildId=999999999999999999"),
      { params: { org: "alpha" } },
    );

    expect(response.status).toBe(403);
    expect(mocks.settingsFindUnique).not.toHaveBeenCalled();
  });
});
