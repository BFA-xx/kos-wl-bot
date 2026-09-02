import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { systemStatus: { upsert: mocks.upsert } },
}));

// Fresh module per test so the in-memory throttle starts from zero.
async function loadPresence() {
  vi.resetModules();
  return import("./presence");
}

describe("markDashboardActive", () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
    mocks.upsert.mockResolvedValue({});
    vi.useRealTimers();
  });

  it("records presence on the first call", async () => {
    const { markDashboardActive } = await loadPresence();
    markDashboardActive();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0].where).toEqual({
      key: "dashboard-active",
    });
  });

  it("throttles the burst of polls an open dashboard produces", async () => {
    const { markDashboardActive } = await loadPresence();
    // Several tabs on 4s SWR timers, all inside one throttle window.
    for (let i = 0; i < 50; i++) markDashboardActive();
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("writes again once the window has passed", async () => {
    vi.useFakeTimers();
    const { markDashboardActive } = await loadPresence();
    markDashboardActive();
    vi.advanceTimersByTime(31_000);
    markDashboardActive();
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries on the next call when the write fails", async () => {
    const { markDashboardActive } = await loadPresence();
    mocks.upsert.mockRejectedValueOnce(new Error("compute suspended"));
    markDashboardActive();
    await new Promise((r) => setImmediate(r));
    // Throttle was released by the failure, so the next request tries again
    // rather than going quiet for the rest of the window.
    markDashboardActive();
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("never throws at the caller when the database is unreachable", async () => {
    const { markDashboardActive } = await loadPresence();
    mocks.upsert.mockRejectedValueOnce(new Error("connection refused"));
    expect(() => markDashboardActive()).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
