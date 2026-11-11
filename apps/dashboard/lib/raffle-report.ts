import type { SheetTab } from "@/lib/google";
import type { RaffleWalletExportRow } from "@/lib/raffle-wallet-export";

export type RaffleReportType =
  | "addresses"
  | "full"
  | "winners"
  | "participants";

export function buildRaffleReportTab(
  type: Exclude<RaffleReportType, "addresses">,
  wallets: RaffleWalletExportRow[],
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
        ...wallets.map((row) => [row.userId, row.username, row.address]),
      ],
    };
  return {
    title: "Winners + Wallets",
    frozenRows: 1,
    columnWidths: [220, 120, 420, 140, 220],
    rows: [
      ["Username", "Chain", "Wallet Address", "Source", "Team Member"],
      ...wallets.map((row) => [
        row.username,
        row.chain,
        row.address,
        row.source,
        row.teamMember ?? "",
      ]),
    ],
  };
}
