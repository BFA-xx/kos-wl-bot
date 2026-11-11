import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  raffle: vi.fn(),
  participants: vi.fn(),
  wallets: vi.fn(),
  previous: vi.fn(),
  audit: vi.fn(),
  token: vi.fn(),
  connection: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  share: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: { findFirst: mocks.raffle },
    participant: { findMany: mocks.participants },
    auditLog: { findFirst: mocks.previous },
    googleConnection: { findUnique: mocks.connection },
  },
}));
vi.mock("@/lib/access", () => ({
  AccessError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  requireOrgAccess: mocks.access,
  logAudit: mocks.audit,
}));
vi.mock("@/lib/google", () => ({
  GoogleError: class extends Error {},
  accessTokenForOrg: mocks.token,
  createSpreadsheet: mocks.create,
  writeSpreadsheet: mocks.write,
  shareSpreadsheet: mocks.share,
}));
vi.mock("@/lib/raffle-wallet-export", () => ({
  raffleWalletExportRows: mocks.wallets,
}));
vi.mock("@/lib/winner-sheet", () => ({
  buildColumnWidthRequests: () => [],
  resolveWinnerSheetGroup: vi.fn(),
  buildWinnerSheetTabs: vi.fn(),
  collectWinnerSheetRows: vi.fn(),
}));
import { POST } from "./route";
import { GET as exportCsv } from "../export/route";
import { AccessError } from "@/lib/access";
const params = { params: { org: "kos", id: "301" } };
function request(type: string) {
  return new NextRequest(
    "https://example.com/api/kos/raffles/301/export-sheet",
    { method: "POST", body: JSON.stringify({ type }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    org: { id: "org" },
    user: { id: "user" },
    guildIds: ["guild"],
  });
  mocks.raffle.mockResolvedValue({
    projectName: "Example",
    walletChains: ["ETHEREUM"],
  });
  mocks.wallets.mockResolvedValue([
    {
      userId: "123456789012345678",
      username: "winner",
      address: "0xabc",
      chain: "ETHEREUM",
      source: "Community",
      teamMember: null,
    },
  ]);
  mocks.token.mockResolvedValue({
    accessToken: "token",
    connectionId: "connection",
  });
  mocks.connection.mockResolvedValue({
    googleUserId: "google-id",
    editorEmails: ["editor@example.com"],
  });
  mocks.previous.mockResolvedValue(null);
  mocks.create.mockResolvedValue({
    spreadsheetId: "sheet",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet",
  });
  mocks.share.mockResolvedValue({ failedEditors: [] });
});
describe("raffle Google Sheets reports", () => {
  it("exports exactly three winner columns with string Discord IDs and private sharing", async () => {
    expect((await POST(request("winners"), params)).status).toBe(200);
    expect(mocks.raffle).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 301, guildId: { in: ["guild"] } },
      }),
    );
    expect(mocks.write.mock.calls[0][2][0].rows).toEqual([
      ["discord_id", "username", "wallet_address"],
      ["123456789012345678", "winner", "0xabc"],
    ]);
    expect(mocks.share).toHaveBeenCalledWith(
      "token",
      "sheet",
      ["editor@example.com"],
      false,
    );
  });
  it("uses report permission for participants and does not fetch wallets", async () => {
    mocks.participants.mockResolvedValue([]);
    await POST(request("participants"), params);
    expect(mocks.access).toHaveBeenCalledWith("kos", "report:export");
    expect(mocks.wallets).not.toHaveBeenCalled();
  });
  it("reopens an unchanged snapshot without replacing manual edits", async () => {
    mocks.previous.mockResolvedValue({
      metadata: {
        spreadsheetId: "existing",
        url: "https://docs.google.com/spreadsheets/d/existing",
      },
    });
    const response = await POST(request("winners"), params);
    expect((await response.json()).url).toContain("existing");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not create a report outside the accessible guilds", async () => {
    mocks.raffle.mockResolvedValue(null);
    expect((await POST(request("full"), params)).status).toBe(404);
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("retains exactly the requested columns on the legacy CSV endpoint", async () => {
    const response = await exportCsv(
      new NextRequest(
        "https://example.com/api/kos/raffles/301/export?type=winners",
      ),
      params,
    );
    const csv = await response.text();
    expect(csv.split("\n")[0].trim()).toBe(
      "discord_id,username,wallet_address",
    );
    expect(csv).not.toContain("Community");
    expect(csv).not.toContain("ETHEREUM");
  });
  it("enforces permission checks before reading raffle data", async () => {
    mocks.access.mockRejectedValue(new AccessError(403, "Forbidden"));
    expect((await POST(request("winners"), params)).status).toBe(403);
    expect(mocks.raffle).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects invalid report types", async () => {
    expect((await POST(request("invalid"), params)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
