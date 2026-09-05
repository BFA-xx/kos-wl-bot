import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  raffleFindFirst: vi.fn(),
  raffleFindMany: vi.fn(),
  exportRows: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    raffle: {
      findFirst: mocks.raffleFindFirst,
      findMany: mocks.raffleFindMany,
    },
  },
}));

vi.mock("@/lib/raffle-wallet-export", () => ({
  raffleWalletExportRows: mocks.exportRows,
}));

import {
  ADDRESSES_TAB,
  WINNERS_TAB,
  buildWinnerSheetFormat,
  buildWinnerSheetTabs,
  collectWinnerSheetRows,
  resolveKinds,
  resolveWinnerSheetGroup,
  type GroupedRaffle,
  type WinnerSheetGroup,
  type WinnerSheetRow,
} from "./winner-sheet";
import type { RaffleWalletExportRow } from "./raffle-wallet-export";

const anchorDate = new Date("2026-09-01T12:00:00Z");

const CHAINS = ["ETHEREUM"] as unknown as GroupedRaffle["walletChains"];

function raffle(
  id: number,
  projectName: string,
  title: string,
  endAt: Date = anchorDate,
) {
  return { id, projectName, title, endAt, walletChains: CHAINS };
}

function exportRow(address: string, username = "user"): RaffleWalletExportRow {
  return {
    position: 1,
    userId: `u-${address}`,
    username,
    chain: CHAINS[0]!,
    address,
    source: "Community",
    teamMember: null,
    recordedAt: null,
    addressHash: `hash-${address.toLowerCase()}`,
  };
}

function sheetRow(
  address: string,
  username: string,
  kind: WinnerSheetRow["kind"],
  raffleId: number,
): WinnerSheetRow {
  return { ...exportRow(address, username), kind, raffleId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.raffleFindMany.mockResolvedValue([]);
  mocks.exportRows.mockResolvedValue([]);
});

describe("resolveKinds", () => {
  it("reads an unlabeled round opposite an FCFS one as the GTD half", () => {
    const resolved = resolveKinds([
      { ...raffle(1, "VOLTOADS", "KOS X VOLTOADS"), kind: "WL" },
      { ...raffle(2, "VOLTOADS", "KOS X VOLTOADS FCFS"), kind: "FCFS" },
    ]);
    expect(resolved.map((r) => r.kind)).toEqual(["GTD", "FCFS"]);
  });

  it("leaves a lone unlabeled round alone", () => {
    const resolved = resolveKinds([
      { ...raffle(1, "VOLTOADS", "KOS X VOLTOADS"), kind: "WL" },
    ]);
    expect(resolved.map((r) => r.kind)).toEqual(["WL"]);
  });
});

describe("resolveWinnerSheetGroup", () => {
  it("pairs a GTD raffle with the same project's FCFS round, GTD first", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      ...raffle(10, "VOLTOADS", "VOLTOADS GTD"),
      collaborationLink: null,
    });
    mocks.raffleFindMany.mockResolvedValue([
      raffle(11, "VOLTOADS", "VOLTOADS FCFS", new Date("2026-09-02T12:00:00Z")),
    ]);

    const group = await resolveWinnerSheetGroup(10, ["guild-a"]);
    expect(group?.raffles.map((r) => [r.id, r.kind])).toEqual([
      [10, "GTD"],
      [11, "FCFS"],
    ]);
  });

  it("puts GTD on top even when the FCFS round is the one opened", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      ...raffle(11, "VOLTOADS", "VOLTOADS FCFS"),
      collaborationLink: null,
    });
    mocks.raffleFindMany.mockResolvedValue([
      raffle(10, "VOLTOADS", "VOLTOADS GTD", new Date("2026-08-31T12:00:00Z")),
    ]);

    const group = await resolveWinnerSheetGroup(11, ["guild-a"]);
    expect(group?.raffles.map((r) => [r.id, r.kind])).toEqual([
      [10, "GTD"],
      [11, "FCFS"],
    ]);
  });

  it("ignores a same-kind round of the same project", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      ...raffle(10, "VOLTOADS", "VOLTOADS GTD"),
      collaborationLink: null,
    });
    mocks.raffleFindMany.mockResolvedValue([
      raffle(12, "VOLTOADS", "VOLTOADS GTD", new Date("2026-09-03T12:00:00Z")),
    ]);

    const group = await resolveWinnerSheetGroup(10, ["guild-a"]);
    expect(group?.raffles.map((r) => r.id)).toEqual([10]);
  });

  it("does not pair across projects", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      ...raffle(10, "VOLTOADS", "VOLTOADS GTD"),
      collaborationLink: null,
    });
    mocks.raffleFindMany.mockResolvedValue([
      raffle(13, "CHAINRAIDERS", "CHAINRAIDERS FCFS"),
    ]);

    const group = await resolveWinnerSheetGroup(10, ["guild-a"]);
    expect(group?.raffles.map((r) => r.id)).toEqual([10]);
  });

  it("takes an explicit collaboration link over title matching", async () => {
    mocks.raffleFindFirst.mockResolvedValue({
      ...raffle(20, "Alpha", "Alpha GTD"),
      collaborationLink: { collaborationId: "collab-1" },
    });
    mocks.raffleFindMany.mockResolvedValue([
      raffle(20, "Alpha", "Alpha GTD"),
      raffle(21, "Alpha renamed", "Second round FCFS"),
    ]);

    const group = await resolveWinnerSheetGroup(20, ["guild-a"]);
    expect(group?.raffles.map((r) => [r.id, r.kind])).toEqual([
      [20, "GTD"],
      [21, "FCFS"],
    ]);
    expect(mocks.raffleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collaborationLink: { collaborationId: "collab-1" },
        }),
      }),
    );
  });

  it("returns null for a raffle outside the caller's guilds", async () => {
    mocks.raffleFindFirst.mockResolvedValue(null);
    expect(await resolveWinnerSheetGroup(99, ["guild-a"])).toBeNull();
  });
});

describe("collectWinnerSheetRows", () => {
  const group: WinnerSheetGroup = {
    anchorId: 10,
    projectName: "VOLTOADS",
    raffles: [
      {
        id: 10,
        projectName: "VOLTOADS",
        title: "GTD",
        kind: "GTD",
        walletChains: CHAINS,
      },
      {
        id: 11,
        projectName: "VOLTOADS",
        title: "FCFS",
        kind: "FCFS",
        walletChains: CHAINS,
      },
    ],
  };

  it("stacks GTD addresses above FCFS ones", async () => {
    mocks.exportRows
      .mockResolvedValueOnce([exportRow("0xAAA"), exportRow("0xBBB")])
      .mockResolvedValueOnce([exportRow("0xCCC")]);

    const data = await collectWinnerSheetRows(group);
    expect(data.rows.map((row) => [row.address, row.kind])).toEqual([
      ["0xAAA", "GTD"],
      ["0xBBB", "GTD"],
      ["0xCCC", "FCFS"],
    ]);
    expect(data.countsByKind).toEqual([
      { kind: "GTD", raffleIds: [10], rows: 2 },
      { kind: "FCFS", raffleIds: [11], rows: 1 },
    ]);
  });

  it("keeps an address that won both rounds once, under GTD", async () => {
    mocks.exportRows
      .mockResolvedValueOnce([exportRow("0xAAA")])
      .mockResolvedValueOnce([exportRow("0xAAA"), exportRow("0xCCC")]);

    const data = await collectWinnerSheetRows(group);
    expect(data.rows.map((row) => [row.address, row.kind])).toEqual([
      ["0xAAA", "GTD"],
      ["0xCCC", "FCFS"],
    ]);
    expect(data.duplicatesRemoved).toBe(1);
  });
});

describe("buildWinnerSheetTabs", () => {
  const data = {
    rows: [
      sheetRow("0xAAA", "alice", "GTD", 10),
      sheetRow("0xCCC", "carol", "FCFS", 11),
    ],
    duplicatesRemoved: 0,
    countsByKind: [
      { kind: "GTD" as const, raffleIds: [10], rows: 1 },
      { kind: "FCFS" as const, raffleIds: [11], rows: 1 },
    ],
  };

  it("writes a banner, a header, and one row per address", () => {
    const [winners, addresses] = buildWinnerSheetTabs("VOLTOADS", data);
    expect(winners!.title).toBe(WINNERS_TAB);
    expect(winners!.rows[0]![0]).toBe("KOS X VOLTOADS");
    expect(winners!.rows[1]).toContain("Wallet Address");
    expect(winners!.rows[2]).toEqual([
      1,
      "GTD",
      "alice",
      "ETHEREUM",
      "0xAAA",
      "Community",
      "",
    ]);
    expect(winners!.rows[3]![1]).toBe("FCFS");

    expect(addresses!.title).toBe(ADDRESSES_TAB);
    expect(addresses!.rows).toEqual([
      ["Wallet Address", "List"],
      ["0xAAA", "GTD"],
      ["0xCCC", "FCFS"],
    ]);
  });

  it("numbers the combined list continuously across both blocks", () => {
    const [winners] = buildWinnerSheetTabs("VOLTOADS", data);
    expect(winners!.rows.slice(2).map((row) => row[0])).toEqual([1, 2]);
  });
});

describe("buildWinnerSheetFormat", () => {
  const data = {
    rows: [],
    duplicatesRemoved: 0,
    countsByKind: [
      { kind: "GTD" as const, raffleIds: [10], rows: 2 },
      { kind: "FCFS" as const, raffleIds: [11], rows: 3 },
    ],
  };

  it("tints each block over its own rows, below the two header rows", () => {
    const requests = buildWinnerSheetFormat(
      new Map([
        [WINNERS_TAB, 0],
        [ADDRESSES_TAB, 1],
      ]),
      data,
    ) as {
      repeatCell?: { range: { startRowIndex: number; endRowIndex: number } };
    }[];

    const ranges = requests
      .filter((request) => request.repeatCell)
      .map((request) => [
        request.repeatCell!.range.startRowIndex,
        request.repeatCell!.range.endRowIndex,
      ]);
    // Banner, header, then the GTD block and the FCFS block back to back.
    expect(ranges).toEqual(
      expect.arrayContaining([
        [2, 4],
        [4, 7],
      ]),
    );
  });

  it("skips a tab that is missing from the spreadsheet", () => {
    const requests = buildWinnerSheetFormat(new Map(), data);
    expect(requests).toEqual([]);
  });
});
