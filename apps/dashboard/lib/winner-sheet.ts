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
  /** Retained for API compatibility; exports now preserve every duplicate. */
  duplicatesRemoved: number;
  countsByKind: { kind: WinnerListKind; raffleIds: number[]; rows: number }[];
}

/**
 * Collect every raffle's winning addresses into one ordered list.
 *
 * Preserve repeated addresses within and across rounds so the team can sort
 * them in the sheet. GTD, FCFS and WL remain separate sections.
 */
export async function collectWinnerSheetRows(
  group: WinnerSheetGroup,
): Promise<WinnerSheetData> {
  const rows: WinnerSheetRow[] = [];
  const counts = new Map<
    WinnerListKind,
    { raffleIds: number[]; rows: number }
  >();

  for (const raffle of group.raffles) {
    const exported = await raffleWalletExportRows(
      raffle.id,
      raffle.walletChains,
    );
    const bucket = counts.get(raffle.kind) ?? { raffleIds: [], rows: 0 };
    bucket.raffleIds.push(raffle.id);
    for (const row of exported) {
      rows.push({ ...row, kind: raffle.kind, raffleId: raffle.id });
      bucket.rows += 1;
    }
    counts.set(raffle.kind, bucket);
  }

  return {
    rows,
    duplicatesRemoved: 0,
    countsByKind: KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
      kind,
      ...counts.get(kind)!,
    })),
  };
}

export function winnerSheetTitle(projectName: string): string {
  return `KOS X ${projectName} — Winners`.slice(0, 120);
}

function addressLayout(data: WinnerSheetData) {
  const rows: string[][] = [];
  const headingRows: number[] = [];
  for (const kind of KIND_ORDER) {
    const addresses = data.rows.filter((row) => row.kind === kind);
    if (addresses.length === 0) continue;
    if (rows.length > 0) rows.push([""]);
    headingRows.push(rows.length);
    rows.push(
      [`${kind} Addresses`],
      ...addresses.map(({ address }) => [address]),
    );
  }
  if (rows.length === 0) {
    headingRows.push(0);
    rows.push(["Wallet Addresses"]);
  }
  return { rows, headingRows };
}

/** Both tabs are link-shared, so include only addresses and section labels. */
export function buildWinnerSheetTabs(
  projectName: string,
  data: WinnerSheetData,
): SheetTab[] {
  const { rows } = addressLayout(data);
  return [
    {
      title: WINNERS_TAB,
      rows: [[`KOS X ${projectName}`], ...rows],
      frozenRows: 1,
      columnWidths: [560],
    },
    {
      title: ADDRESSES_TAB,
      rows,
      frozenRows: 0,
      columnWidths: [560],
    },
  ];
}

const INK = { red: 0.09, green: 0.09, blue: 0.09 };
const BANNER_FILL = { red: 0.93, green: 0.93, blue: 0.93 };
const HEADER_FILL = { red: 0.85, green: 0.85, blue: 0.85 };

export function buildWinnerSheetFormat(
  tabIds: Map<string, number>,
  data: WinnerSheetData,
): unknown[] {
  const { headingRows } = addressLayout(data);
  const requests: unknown[] = [];
  for (const title of [WINNERS_TAB, ADDRESSES_TAB]) {
    const sheetId = tabIds.get(title);
    if (sheetId === undefined) continue;
    const hasBanner = title === WINNERS_TAB;
    if (hasBanner) {
      // Old Winner tabs had a merged banner and a filter over four columns.
      requests.push(
        { clearBasicFilter: { sheetId } },
        { unmergeCells: { range: { sheetId } } },
      );
    }
    requests.push(
      { updateCells: { range: { sheetId }, fields: "userEnteredFormat" } },
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: hasBanner ? 1 : 0 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
    );
    if (hasBanner) {
      requests.push(
        cellFormat(sheetId, 0, {
          backgroundColor: BANNER_FILL,
          horizontalAlignment: "CENTER",
          textFormat: { bold: true, fontSize: 14, foregroundColor: INK },
        }),
      );
    }
    for (const index of headingRows) {
      requests.push(
        cellFormat(sheetId, index + (hasBanner ? 1 : 0), {
          backgroundColor: HEADER_FILL,
          textFormat: { bold: true, foregroundColor: INK },
        }),
      );
    }
  }
  return requests;
}

function cellFormat(
  sheetId: number,
  rowIndex: number,
  format: Record<string, unknown>,
) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: { userEnteredFormat: format },
      fields: "userEnteredFormat",
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
