import type { WalletChain } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  historicalProjectKey,
  historicalRaffleVariant,
} from "@/lib/collab-history";
import {
  raffleWalletExportRows,
  type RaffleWalletExportRow,
} from "@/lib/raffle-wallet-export";
import type { SheetTab } from "@/lib/google";

/**
 * The winner handover sheet.
 *
 * A collaboration is normally run as two raffles — a guaranteed (GTD) round
 * and a first-come (FCFS) round — but the partner is handed one list. This
 * module resolves those halves back into a single group, orders GTD above
 * FCFS, and lays the combined list out as Google Sheets tabs.
 */

export type WinnerListKind = "GTD" | "FCFS" | "WL";

/** GTD first, FCFS below it, anything unlabeled last. */
const KIND_ORDER: WinnerListKind[] = ["GTD", "FCFS", "WL"];

/** How far apart two rounds of the same project can sit and still be a pair. */
const PAIR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const WINNERS_TAB = "Winners";
export const ADDRESSES_TAB = "Addresses";

export interface GroupedRaffle {
  id: number;
  projectName: string;
  title: string;
  kind: WinnerListKind;
  walletChains: WalletChain[];
}

export interface WinnerSheetGroup {
  /** The raffle the sheet was opened from. */
  anchorId: number;
  /** Name the sheet is titled after — the anchor's project. */
  projectName: string;
  raffles: GroupedRaffle[];
}

type RaffleRecord = {
  id: number;
  projectName: string;
  title: string;
  endAt: Date;
  walletChains: WalletChain[];
};

function sortByKind(raffles: GroupedRaffle[]): GroupedRaffle[] {
  return [...raffles].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id - b.id,
  );
}

/**
 * An unlabeled round sitting opposite an explicit FCFS round is the guaranteed
 * half — the same inference the collaboration importer makes for raffles from
 * before the GTD/FCFS titles were a convention.
 */
export function resolveKinds(
  raffles: (RaffleRecord & { kind: WinnerListKind })[],
): (RaffleRecord & { kind: WinnerListKind })[] {
  const hasFcfs = raffles.some((raffle) => raffle.kind === "FCFS");
  return raffles.map((raffle) =>
    raffle.kind === "WL" && hasFcfs ? { ...raffle, kind: "GTD" } : raffle,
  );
}

/**
 * Which raffles belong on one sheet.
 *
 * An explicit collaboration link is the team's own grouping and is trusted as
 * given. Without one, a GTD round is paired with the nearest ENDED FCFS round
 * of the same project (and vice versa) — one partner per sheet, so a project
 * that ran two separate collaborations months apart does not collapse into a
 * single list.
 */
export async function resolveWinnerSheetGroup(
  raffleId: number,
  guildIds: string[],
): Promise<WinnerSheetGroup | null> {
  const anchor = await prisma.raffle.findFirst({
    where: { id: raffleId, guildId: { in: guildIds } },
    select: {
      id: true,
      projectName: true,
      title: true,
      endAt: true,
      walletChains: true,
      collaborationLink: { select: { collaborationId: true } },
    },
  });
  if (!anchor) return null;

  const collaborationId = anchor.collaborationLink?.collaborationId;
  const found: RaffleRecord[] = collaborationId
    ? await prisma.raffle.findMany({
        where: {
          guildId: { in: guildIds },
          collaborationLink: { collaborationId },
        },
        select: {
          id: true,
          projectName: true,
          title: true,
          endAt: true,
          walletChains: true,
        },
      })
    : await pairByProject(anchor, guildIds);

  const withAnchor = found.some((raffle) => raffle.id === anchor.id)
    ? found
    : [...found, anchor];
  const classified = resolveKinds(
    withAnchor.map((raffle) => ({
      ...raffle,
      kind: historicalRaffleVariant(raffle) as WinnerListKind,
    })),
  );

  return {
    anchorId: anchor.id,
    projectName: anchor.projectName,
    raffles: sortByKind(
      classified.map(({ id, projectName, title, kind, walletChains }) => ({
        id,
        projectName,
        title,
        kind,
        walletChains,
      })),
    ),
  };
}

/** The nearest drawn round of the opposite kind for the same project. */
async function pairByProject(
  anchor: RaffleRecord,
  guildIds: string[],
): Promise<RaffleRecord[]> {
  const anchorKind = historicalRaffleVariant(anchor) as WinnerListKind;
  if (anchorKind === "WL") return [anchor];
  const wanted: WinnerListKind = anchorKind === "GTD" ? "FCFS" : "GTD";
  const projectKey = historicalProjectKey(anchor.projectName);

  const candidates = await prisma.raffle.findMany({
    where: {
      guildId: { in: guildIds },
      status: "ENDED",
      id: { not: anchor.id },
      endAt: {
        gte: new Date(anchor.endAt.getTime() - PAIR_WINDOW_MS),
        lte: new Date(anchor.endAt.getTime() + PAIR_WINDOW_MS),
      },
    },
    select: {
      id: true,
      projectName: true,
      title: true,
      endAt: true,
      walletChains: true,
    },
    orderBy: { endAt: "desc" },
    take: 50,
  });

  const match = candidates
    .filter(
      (raffle) =>
        historicalProjectKey(raffle.projectName) === projectKey &&
        // An unlabeled round counts as the GTD half only when we are the FCFS
        // one looking for it.
        (historicalRaffleVariant(raffle) === wanted ||
          (wanted === "GTD" && historicalRaffleVariant(raffle) === "WL")),
    )
    .sort(
      (a, b) =>
        Math.abs(a.endAt.getTime() - anchor.endAt.getTime()) -
        Math.abs(b.endAt.getTime() - anchor.endAt.getTime()),
    )[0];

  return match ? [anchor, match] : [anchor];
}

export interface WinnerSheetRow extends RaffleWalletExportRow {
  kind: WinnerListKind;
  raffleId: number;
}

export interface WinnerSheetData {
  rows: WinnerSheetRow[];
  /** Addresses dropped because they already appeared higher in the list. */
  duplicatesRemoved: number;
  countsByKind: { kind: WinnerListKind; raffleIds: number[]; rows: number }[];
}

/**
 * Collect every raffle's winning addresses into one ordered list.
 *
 * A wallet that won both rounds is kept once, in the GTD block: the partner
 * grants one spot per address, so a duplicate across the two lists would cost
 * the collaboration a slot.
 */
export async function collectWinnerSheetRows(
  group: WinnerSheetGroup,
): Promise<WinnerSheetData> {
  const seen = new Set<string>();
  const rows: WinnerSheetRow[] = [];
  const counts = new Map<
    WinnerListKind,
    { raffleIds: number[]; rows: number }
  >();
  let duplicatesRemoved = 0;

  for (const raffle of group.raffles) {
    const exported = await raffleWalletExportRows(
      raffle.id,
      raffle.walletChains,
    );
    const bucket = counts.get(raffle.kind) ?? { raffleIds: [], rows: 0 };
    bucket.raffleIds.push(raffle.id);
    for (const row of exported) {
      if (seen.has(row.addressHash)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(row.addressHash);
      rows.push({ ...row, kind: raffle.kind, raffleId: raffle.id });
      bucket.rows += 1;
    }
    counts.set(raffle.kind, bucket);
  }

  return {
    rows,
    duplicatesRemoved,
    countsByKind: KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
      kind,
      ...counts.get(kind)!,
    })),
  };
}

const WINNERS_HEADER = [
  "#",
  "List",
  "Username",
  "Chain",
  "Wallet Address",
  "Source",
  "Team Member",
];

export function winnerSheetTitle(projectName: string): string {
  return `KOS X ${projectName} — Winners`.slice(0, 120);
}

/** The two tabs: the working list, and a clean column to hand over. */
export function buildWinnerSheetTabs(
  projectName: string,
  data: WinnerSheetData,
): SheetTab[] {
  const banner = `KOS X ${projectName}`;
  const winners: (string | number)[][] = [
    [banner, "", "", "", "", "", ""],
    WINNERS_HEADER,
    ...data.rows.map((row, index) => [
      index + 1,
      row.kind,
      row.username,
      row.chain,
      row.address,
      row.source,
      row.teamMember ?? "",
    ]),
  ];

  const addresses: (string | number)[][] = [
    ["Wallet Address", "List"],
    ...data.rows.map((row) => [row.address, row.kind]),
  ];

  return [
    {
      title: WINNERS_TAB,
      rows: winners,
      frozenRows: 2,
      columnWidths: [48, 72, 190, 110, 400, 110, 160],
    },
    {
      title: ADDRESSES_TAB,
      rows: addresses,
      frozenRows: 1,
      columnWidths: [400, 72],
    },
  ];
}

const INK = { red: 0.09, green: 0.09, blue: 0.09 };
const BANNER_FILL = { red: 0.93, green: 0.93, blue: 0.93 };
const HEADER_FILL = { red: 0.85, green: 0.85, blue: 0.85 };
/** A faint wash behind the FCFS block so the split is visible while scrolling. */
const FCFS_FILL = { red: 0.96, green: 0.97, blue: 1 };
const WHITE = { red: 1, green: 1, blue: 1 };

/**
 * Formatting for both tabs. Every request is idempotent so a re-sync repaints
 * rather than accumulating, and the data region is reset first so a list that
 * shrank does not leave the previous block's tint stranded below it.
 */
export function buildWinnerSheetFormat(
  tabIds: Map<string, number>,
  data: WinnerSheetData,
): unknown[] {
  const winnersId = tabIds.get(WINNERS_TAB);
  const addressesId = tabIds.get(ADDRESSES_TAB);
  const requests: unknown[] = [];
  const dataRows = data.rows.length;
  // Reset well past the current list so formatting left by a longer previous
  // sync is cleared too.
  const resetTo = dataRows + 2 + 1000;

  if (winnersId !== undefined) {
    requests.push(
      {
        updateCells: {
          range: { sheetId: winnersId, startRowIndex: 0, endRowIndex: resetTo },
          fields: "userEnteredFormat",
        },
      },
      {
        mergeCells: {
          range: {
            sheetId: winnersId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: WINNERS_HEADER.length,
          },
          mergeType: "MERGE_ALL",
        },
      },
      cellFormat(winnersId, 0, 1, {
        backgroundColor: BANNER_FILL,
        horizontalAlignment: "CENTER",
        verticalAlignment: "MIDDLE",
        textFormat: { bold: true, fontSize: 14, foregroundColor: INK },
      }),
      cellFormat(winnersId, 1, 2, {
        backgroundColor: HEADER_FILL,
        textFormat: { bold: true, foregroundColor: INK },
      }),
      {
        updateSheetProperties: {
          properties: {
            sheetId: winnersId,
            gridProperties: { frozenRowCount: 2 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: winnersId,
            dimension: "ROWS",
            startIndex: 0,
            endIndex: 1,
          },
          properties: { pixelSize: 30 },
          fields: "pixelSize",
        },
      },
    );

    // Tint each block so GTD and FCFS read as two sections of one list.
    let offset = 2;
    for (const block of data.countsByKind) {
      if (block.rows > 0) {
        requests.push(
          cellFormat(winnersId, offset, offset + block.rows, {
            backgroundColor: block.kind === "FCFS" ? FCFS_FILL : WHITE,
          }),
        );
      }
      offset += block.rows;
    }

    if (dataRows > 0) {
      requests.push({
        setBasicFilter: {
          filter: {
            range: {
              sheetId: winnersId,
              startRowIndex: 1,
              endRowIndex: dataRows + 2,
              startColumnIndex: 0,
              endColumnIndex: WINNERS_HEADER.length,
            },
          },
        },
      });
    }
  }

  if (addressesId !== undefined) {
    requests.push(
      {
        updateCells: {
          range: {
            sheetId: addressesId,
            startRowIndex: 0,
            endRowIndex: resetTo,
          },
          fields: "userEnteredFormat",
        },
      },
      cellFormat(addressesId, 0, 1, {
        backgroundColor: HEADER_FILL,
        textFormat: { bold: true, foregroundColor: INK },
      }),
      {
        updateSheetProperties: {
          properties: {
            sheetId: addressesId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
    );
  }

  return requests;
}

function cellFormat(
  sheetId: number,
  startRowIndex: number,
  endRowIndex: number,
  format: Record<string, unknown>,
) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex, endRowIndex },
      cell: { userEnteredFormat: format },
      fields:
        "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  };
}

/** Column widths, applied once the tab ids are known. */
export function buildColumnWidthRequests(
  tabIds: Map<string, number>,
  tabs: SheetTab[],
): unknown[] {
  const requests: unknown[] = [];
  for (const tab of tabs) {
    const sheetId = tabIds.get(tab.title);
    if (sheetId === undefined || !tab.columnWidths) continue;
    tab.columnWidths.forEach((pixelSize, index) => {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: index,
            endIndex: index + 1,
          },
          properties: { pixelSize },
          fields: "pixelSize",
        },
      });
    });
  }
  return requests;
}
