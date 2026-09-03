import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  verifyXFollow: vi.fn(),
  xVerifyConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    identityAccount: { findUnique: mocks.findUnique, update: mocks.update },
  },
}));
vi.mock("@kos/db", () => ({
  verifyXFollow: mocks.verifyXFollow,
  xVerifyConfigured: mocks.xVerifyConfigured,
}));

import { evaluateXFollowGate } from "./x-follow";

const linked = { username: "member", accessToken: "enc", metadata: {} };

describe("Telegram X follow gate", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    process.env.KOS_X_HANDLE = "kosinweb3";
    mocks.xVerifyConfigured.mockReturnValue(true);
    mocks.update.mockResolvedValue(null);
  });

  it("asks for an X link before it asks for a follow", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const gate = await evaluateXFollowGate("id-1");
    expect(gate.status).toBe("needs_link");
    expect(mocks.verifyXFollow).not.toHaveBeenCalled();
  });

  it("passes a proven follow and records it so it is never re-bought", async () => {
    mocks.findUnique.mockResolvedValue(linked);
    mocks.verifyXFollow.mockResolvedValue({ outcome: "following", reads: 1 });
    const gate = await evaluateXFollowGate("id-1");
    expect(gate.status).toBe("following");
    expect(mocks.update).toHaveBeenCalled();
  });

  it("does not spend a read once the pass is recorded", async () => {
    mocks.findUnique.mockResolvedValue({
      ...linked,
      metadata: { followedTargets: ["kosinweb3"] },
    });
    const gate = await evaluateXFollowGate("id-1");
    expect(gate.status).toBe("following");
    expect(mocks.verifyXFollow).not.toHaveBeenCalled();
  });

  it("treats a protected account's pending request as done", async () => {
    mocks.findUnique.mockResolvedValue(linked);
    mocks.verifyXFollow.mockResolvedValue({ outcome: "follow_pending", reads: 1 });
    expect((await evaluateXFollowGate("id-1")).status).toBe("following");
  });

  it("blocks only on a definite no", async () => {
    mocks.findUnique.mockResolvedValue(linked);
    mocks.verifyXFollow.mockResolvedValue({ outcome: "not_following", reads: 1 });
    expect((await evaluateXFollowGate("id-1")).status).toBe("needs_follow");
  });

  it("never tells a member they failed when X could not be reached", async () => {
    // An outage must not read as "you didn't follow" — the member did nothing
    // wrong and the wording has to reflect that.
    mocks.findUnique.mockResolvedValue(linked);
    for (const outcome of ["unavailable", "rate_limited", "budget_exhausted"]) {
      mocks.verifyXFollow.mockResolvedValue({ outcome, reads: 0 });
      const gate = await evaluateXFollowGate("id-1");
      expect(gate.status).toBe("unverifiable");
      expect(gate.status === "unverifiable" && gate.reason).toBeTruthy();
    }
  });

  it("sends an expired token back to relinking, not to following", async () => {
    mocks.findUnique.mockResolvedValue(linked);
    mocks.verifyXFollow.mockResolvedValue({ outcome: "token_expired", reads: 0 });
    expect((await evaluateXFollowGate("id-1")).status).toBe("needs_link");
  });

  it("stands down entirely when no handle is configured", async () => {
    // With nothing to follow the gate must not strand anyone at onboarding.
    process.env.KOS_X_HANDLE = "";
    expect((await evaluateXFollowGate("id-1")).status).toBe("not_configured");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("cannot be passed while checks are paused", async () => {
    mocks.findUnique.mockResolvedValue(linked);
    mocks.xVerifyConfigured.mockReturnValue(false);
    const gate = await evaluateXFollowGate("id-1");
    expect(gate.status).toBe("unverifiable");
    expect(mocks.verifyXFollow).not.toHaveBeenCalled();
  });
});
