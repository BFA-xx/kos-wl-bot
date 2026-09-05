import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sheetRaffleFindFirst: vi.fn(),
  winnerAggregate: vi.fn(),
  walletAggregate: vi.fn(),
  teamWalletAggregate: vi.fn(),
  connectionFindUnique: vi.fn(),
  transaction: vi.fn(),
  sheetUpsert: vi.fn(),
  sheetRaffleUpsert: vi.fn(),
  accessToken: vi.fn(),
  createSpreadsheet: vi.fn(),
  writeSpreadsheet: vi.fn(),
  shareSpreadsheet: vi.fn(),
  tabIds: vi.fn(),
  resolveGroup: vi.fn(),
  collectRows: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    winnerSheetRaffle: { findFirst: mocks.sheetRaffleFindFirst },
    winner: { aggregate: mocks.winnerAggregate },
    wallet: { aggregate: mocks.walletAggregate },
    teamWalletUsage: { aggregate: mocks.teamWalletAggregate },
    googleConnection: { findUnique: mocks.connectionFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/google", () => ({
  accessTokenForOrg: mocks.accessToken,
  createSpreadsheet: mocks.createSpreadsheet,
  writeSpreadsheet: mocks.writeSpreadsheet,
  shareSpreadsheet: mocks.shareSpreadsheet,
  spreadsheetTabIds: mocks.tabIds,
}));

vi.mock("@/lib/winner-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./winner-sheet")>();
  return {
    ...actual,
    resolveWinnerSheetGroup: mocks.resolveGroup,
    collectWinnerSheetRows: mocks.collectRows,
  };
});

import { syncWinnerSheet, winnerSheetState } from "./winner-sheet-sync";

const SYNCED_AT = new Date("2026-09-04T10:00:00Z");

const group = {
  anchorId: 10,
  projectName: "VOLTOADS",
  raffles: [
    {
      id: 10,
      projectName: "VOLTOADS",
      title: "GTD",
      kind: "GTD" as const,
      walletChains: [],
    },
    {
      id: 11,
      projectName: "VOLTOADS",
      title: "FCFS",
      kind: "FCFS" as const,
      walletChains: [],
    },
  ],
};

function existingLink(raffleIds = [10, 11], syncedAt = SYNCED_AT) {
  return {
    raffleId: raffleIds[0],
    sheet: {
      id: "sheet-1",
      spreadsheetId: "ss-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/ss-1/edit",
      rowCount: 42,
      syncedAt,
      raffles: raffleIds.map((raffleId) => ({ raffleId })),
    },
  };
}

function noChanges() {
  mocks.winnerAggregate.mockResolvedValue({ _max: { selectedAt: null } });
  mocks.walletAggregate.mockResolvedValue({ _max: { submittedAt: null } });
  mocks.teamWalletAggregate.mockResolvedValue({ _max: { reservedAt: null } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveGroup.mockResolvedValue(group);
  mocks.sheetRaffleFindFirst.mockResolvedValue(null);
  mocks.connectionFindUnique.mockResolvedValue({ editorEmails: ["a@b.com"] });
  mocks.accessToken.mockResolvedValue({
    accessToken: "token",
    connectionId: "conn-1",
    email: "owner@kos.xyz",
  });
  mocks.collectRows.mockResolvedValue({
    rows: [],
    duplicatesRemoved: 2,
    countsByKind: [
      { kind: "GTD", raffleIds: [10], rows: 3 },
      { kind: "FCFS", raffleIds: [11], rows: 1 },
    ],
  });
  mocks.createSpreadsheet.mockResolvedValue({
    spreadsheetId: "ss-new",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/ss-new/edit",
  });
  mocks.tabIds.mockResolvedValue(
    new Map([
      ["Winners", 0],
      ["Addresses", 1],
    ]),
  );
  mocks.shareSpreadsheet.mockResolvedValue({ failedEditors: [] });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      winnerSheet: { upsert: mocks.sheetUpsert },
      winnerSheetRaffle: { upsert: mocks.sheetRaffleUpsert },
    }),
  );
  mocks.sheetUpsert.mockResolvedValue({
    id: "sheet-1",
    spreadsheetId: "ss-new",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/ss-new/edit",
    rowCount: 0,
    syncedAt: SYNCED_AT,
  });
  mocks.sheetRaffleUpsert.mockResolvedValue({});
  noChanges();
});

const options = {
  organizationId: "org-1",
  guildIds: ["guild-a"],
  raffleId: 10,
  userId: "user-1",
};

describe("syncWinnerSheet", () => {
  it("creates the sheet on first open and links every raffle in the group", async () => {
    const result = await syncWinnerSheet(options);

    expect(result.created).toBe(true);
    expect(result.url).toContain("ss-new");
    expect(mocks.createSpreadsheet).toHaveBeenCalledTimes(1);
    expect(
      mocks.sheetRaffleUpsert.mock.calls.map((call) => call[0].create),
    ).toEqual([
      { sheetId: "sheet-1", raffleId: 10, kind: "GTD" },
      { sheetId: "sheet-1", raffleId: 11, kind: "FCFS" },
    ]);
  });

  it("shares the sheet with the org's editors", async () => {
    await syncWinnerSheet(options);
    expect(mocks.shareSpreadsheet).toHaveBeenCalledWith("token", "ss-new", [
      "a@b.com",
    ]);
  });

  it("opens an existing sheet without rewriting the team's edits", async () => {
    mocks.sheetRaffleFindFirst.mockResolvedValue(existingLink());

    const result = await syncWinnerSheet(options);

    expect(result.created).toBe(false);
    expect(result.rewritten).toBe(false);
    expect(result.url).toContain("ss-1");
    expect(mocks.createSpreadsheet).not.toHaveBeenCalled();
    expect(mocks.writeSpreadsheet).not.toHaveBeenCalled();
    expect(mocks.accessToken).not.toHaveBeenCalled();
  });

  it("rewrites the existing spreadsheet in place when asked", async () => {
    mocks.sheetRaffleFindFirst.mockResolvedValue(existingLink());

    const result = await syncWinnerSheet({ ...options, rewrite: true });

    expect(result.created).toBe(false);
    expect(result.rewritten).toBe(true);
    expect(mocks.createSpreadsheet).not.toHaveBeenCalled();
    expect(mocks.writeSpreadsheet).toHaveBeenCalledWith(
      "token",
      "ss-1",
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("reports the duplicates folded out of the combined list", async () => {
    const result = await syncWinnerSheet(options);
    expect(result.duplicatesRemoved).toBe(2);
    expect(result.blocks).toEqual([
      { kind: "GTD", rows: 3 },
      { kind: "FCFS", rows: 1 },
    ]);
  });

  it("fails when the raffle is outside the caller's guilds", async () => {
    mocks.resolveGroup.mockResolvedValue(null);
    await expect(syncWinnerSheet(options)).rejects.toThrow("Raffle not found.");
  });
});

describe("winnerSheetState", () => {
  it("is null before a sheet exists", async () => {
    expect(await winnerSheetState(10, ["guild-a"])).toBeNull();
  });

  it("flags a round drawn after the sheet was written", async () => {
    mocks.sheetRaffleFindFirst.mockResolvedValue(existingLink([10]));

    const state = await winnerSheetState(10, ["guild-a"]);

    expect(state?.raffleIds).toEqual([10]);
    expect(state?.missingRaffleIds).toEqual([11]);
  });

  it("flags a reroll that landed after the last sync", async () => {
    mocks.sheetRaffleFindFirst.mockResolvedValue(existingLink());
    mocks.winnerAggregate.mockResolvedValue({
      _max: { selectedAt: new Date("2026-09-04T11:00:00Z") },
    });

    expect((await winnerSheetState(10, ["guild-a"]))?.stale).toBe(true);
  });

  it("is not stale when nothing changed since the sync", async () => {
    mocks.sheetRaffleFindFirst.mockResolvedValue(existingLink());
    mocks.winnerAggregate.mockResolvedValue({
      _max: { selectedAt: new Date("2026-09-04T09:00:00Z") },
    });

    const state = await winnerSheetState(10, ["guild-a"]);
    expect(state?.stale).toBe(false);
    expect(state?.missingRaffleIds).toEqual([]);
  });
});
