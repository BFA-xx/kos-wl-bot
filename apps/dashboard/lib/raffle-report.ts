import type { SheetTab } from "@/lib/google";
import type { RaffleWalletExportRow } from "@/lib/raffle-wallet-export";
import type { WinnerListKind } from "@/lib/winner-sheet";

export type RaffleReportType =
  | "addresses"
  | "full"
  | "winners"
  | "participants";

export function buildRaffleReportTab(
  type: Exclude<RaffleReportType, "addresses">,
  wallets: (RaffleWalletExportRow & { kind?: WinnerListKind })[],
  participants: {
    userId: string;
    username: string;
    enteredAt: Date;
    flagged: boolean;
    flagReason: string | null;
  }[] = [],
): SheetTab {
  if (type === "participants")
    return {
      title: "Participants",
      frozenRows: 1,
      columnWidths: [180, 220, 200, 90, 320],
      rows: [
        ["discord_id", "username", "entered_at", "flagged", "flag_reason"],
        ...participants.map((row) => [
          row.userId,
          row.username,
          row.enteredAt.toISOString(),
          row.flagged ? "yes" : "no",
          row.flagReason ?? "",
        ]),
      ],
    };
  if (type === "winners")
    return {
      title: "Winners",
      frozenRows: 1,
      columnWidths: [180, 220, 420],
      rows: [
        ["discord_id", "username", "wallet_address"],
        ...groupedReportRows(wallets, 3, (row) => [
          row.userId,
          row.username,
          row.address,
        ]),
      ],
    };
  return {
    title: "Winners + Wallets",
    frozenRows: 1,
    columnWidths: [220, 120, 420, 140, 220],
    rows: [
      ["Username", "Chain", "Wallet Address", "Source", "Team Member"],
      ...groupedReportRows(wallets, 5, (row) => [
        row.username,
        row.chain,
        row.address,
        row.source,
        row.teamMember ?? "",
      ]),
    ],
  };
}

function groupedReportRows(
  wallets: (RaffleWalletExportRow & { kind?: WinnerListKind })[],
  columns: number,
  values: (row: RaffleWalletExportRow) => string[],
): string[][] {
  const rows: string[][] = [];
  for (const kind of ["GTD", "FCFS", "WL"] as const) {
    const group = wallets.filter((row) => (row.kind ?? "WL") === kind);
    if (!group.length) continue;
    if (rows.length) rows.push(Array(columns).fill(""));
    rows.push([`${kind} Addresses`, ...Array(columns - 1).fill("")]);
    rows.push(...group.map(values));
  }
  return rows;
}

/** Visually separate the column header and list headings without adding columns. */
export function buildRaffleReportFormat(
  tab: SheetTab,
  sheetId: number,
): unknown[] {
  return tab.rows.flatMap((row, index) => {
    const heading =
      ["GTD Addresses", "FCFS Addresses", "WL Addresses"].includes(
        String(row[0]),
      ) && row.slice(1).every((value) => value === "");
    if (index !== 0 && !heading) return [];
    return [
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: index,
            endRowIndex: index + 1,
            startColumnIndex: 0,
            endColumnIndex: tab.columnWidths?.length ?? row.length,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
    ];
  });
}
