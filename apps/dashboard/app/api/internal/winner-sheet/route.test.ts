import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  report: vi.fn(),
  handover: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { guildConnection: { findUnique: mocks.connection } },
}));
vi.mock("@/lib/access", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/raffle-report-sync", () => ({ syncRaffleReport: mocks.report }));
vi.mock("@/lib/winner-sheet-sync", () => ({
  WinnerSheetError: class extends Error {},
  syncWinnerSheet: mocks.handover,
}));
import { POST } from "./route";
const token = "test-token-that-is-at-least-thirty-two-characters";
function request(type: string, bearer = token) {
  return new Request("https://example.com/api/internal/winner-sheet", {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      raffleId: 301,
      guildId: "guild",
      actorId: "actor",
      type,
    }),
  });
}
beforeEach(() => {
  vi.stubEnv("BOT_API_TOKEN", token);
  mocks.connection.mockResolvedValue({
    organization: { id: "org", suspendedAt: null },
  });
  mocks.report.mockResolvedValue({
    url: "https://docs.google.com/spreadsheets/d/test",
    failedEditors: [],
  });
});
describe("Discord report endpoint", () => {
  it.each(["winners", "participants", "addresses", "full"])(
    "serves %s reports scoped to the calling guild",
    async (type) => {
      expect((await POST(request(type))).status).toBe(200);
      expect(mocks.report).toHaveBeenCalledWith({
        organizationId: "org",
        userId: "actor",
        guildIds: ["guild"],
        id: 301,
        type,
      });
      expect(mocks.handover).not.toHaveBeenCalled();
    },
  );
  it("rejects requests without the bot secret", async () => {
    expect((await POST(request("winners", "wrong"))).status).toBe(401);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it("rejects suspended organizations", async () => {
    mocks.connection.mockResolvedValue({
      organization: { id: "org", suspendedAt: new Date() },
    });
    expect((await POST(request("participants"))).status).toBe(403);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
