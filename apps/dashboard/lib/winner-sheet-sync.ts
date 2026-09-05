import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  accessTokenForOrg,
  createSpreadsheet,
  shareSpreadsheet,
  spreadsheetTabIds,
  writeSpreadsheet,
  type SheetTab,
} from "@/lib/google";
import {
  ADDRESSES_TAB,
  WINNERS_TAB,
  buildColumnWidthRequests,
  buildWinnerSheetFormat,
  buildWinnerSheetTabs,
  collectWinnerSheetRows,
  resolveWinnerSheetGroup,
  winnerSheetTitle,
  type WinnerListKind,
} from "@/lib/winner-sheet";

/**
 * Create-or-open side of the winner handover sheet.
 *
 * Opening an existing sheet deliberately does *not* rewrite it: the whole
 * point is that the team edits the list in place before handing it over, and a
 * silent re-sync on every click would throw those edits away. Rewriting is an
 * explicit action, and the caller is told when the sheet has fallen behind.
 */

export interface WinnerSheetState {
  spreadsheetId: string;
  url: string;
  rowCount: number;
  syncedAt: string;
  /** Raffles whose winners are already written into the sheet. */
  raffleIds: number[];
  /** Group members drawn since the last sync and not yet in the sheet. */
  missingRaffleIds: number[];
  /** True when winners or wallets changed after the last sync. */
  stale: boolean;
}

export interface WinnerSheetSyncResult extends WinnerSheetState {
  created: boolean;
  rewritten: boolean;
  duplicatesRemoved: number;
  blocks: { kind: WinnerListKind; rows: number }[];
  /** Editor emails Google refused (unknown address, not a Google account). */
  failedEditors: string[];
}

/** The sheet covering this raffle, or null when none has been created. */
export async function winnerSheetState(
  raffleId: number,
  guildIds: string[],
): Promise<WinnerSheetState | null> {
  const group = await resolveWinnerSheetGroup(raffleId, guildIds);
  if (!group) return null;
  const groupIds = group.raffles.map((raffle) => raffle.id);

  const link = await prisma.winnerSheetRaffle.findFirst({
    where: { raffleId: { in: groupIds } },
    include: { sheet: { include: { raffles: true } } },
  });
  if (!link) return null;

  const covered = link.sheet.raffles.map((row) => row.raffleId);
  return {
    spreadsheetId: link.sheet.spreadsheetId,
    url: link.sheet.spreadsheetUrl,
    rowCount: link.sheet.rowCount,
    syncedAt: link.sheet.syncedAt.toISOString(),
    raffleIds: covered,
    missingRaffleIds: groupIds.filter((id) => !covered.includes(id)),
    stale: await changedSince(
      [...new Set([...covered, ...groupIds])],
      link.sheet.syncedAt,
    ),
  };
}

/**
 * Whether a reroll, a late wallet submission, or a team-wallet fill has landed
 * since the sheet was written.
 */
async function changedSince(
  raffleIds: number[],
  syncedAt: Date,
): Promise<boolean> {
  const [winners, wallets, teamWallets] = await Promise.all([
    prisma.winner.aggregate({
      where: { raffleId: { in: raffleIds } },
      _max: { selectedAt: true },
    }),
    prisma.wallet.aggregate({
      where: { winner: { raffleId: { in: raffleIds } } },
      _max: { submittedAt: true },
    }),
    prisma.teamWalletUsage.aggregate({
      where: { raffleId: { in: raffleIds }, status: "RESERVED" },
      _max: { reservedAt: true },
    }),
  ]);
  return [
    winners._max.selectedAt,
    wallets._max.submittedAt,
    teamWallets._max.reservedAt,
  ].some((at) => at !== null && at > syncedAt);
}

export class WinnerSheetError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WinnerSheetError";
  }
}

export interface SyncWinnerSheetOptions {
  organizationId: string;
  guildIds: string[];
  raffleId: number;
  userId: string;
  /** Rewrite an existing sheet from the raffle, discarding manual edits. */
  rewrite?: boolean;
}

export async function syncWinnerSheet({
  organizationId,
  guildIds,
  raffleId,
  userId,
  rewrite = false,
}: SyncWinnerSheetOptions): Promise<WinnerSheetSyncResult> {
  const group = await resolveWinnerSheetGroup(raffleId, guildIds);
  if (!group) throw new WinnerSheetError(404, "Raffle not found.");

  const existing = await winnerSheetState(raffleId, guildIds);
  if (existing && !rewrite) {
    return {
      ...existing,
      created: false,
      rewritten: false,
      duplicatesRemoved: 0,
      blocks: [],
      failedEditors: [],
    };
  }

  const { accessToken, connectionId } = await accessTokenForOrg(organizationId);
  const connection = await prisma.googleConnection.findUnique({
    where: { id: connectionId },
    select: { editorEmails: true },
  });

  const data = await collectWinnerSheetRows(group);
  const tabs = buildWinnerSheetTabs(group.projectName, data);

  let spreadsheetId = existing?.spreadsheetId;
  let url = existing?.url ?? "";
  const created = !spreadsheetId;
  if (!spreadsheetId) {
    const sheet = await createSpreadsheet(
      accessToken,
      winnerSheetTitle(group.projectName),
      tabs,
    );
    spreadsheetId = sheet.spreadsheetId;
    url = sheet.spreadsheetUrl;
  }

  const tabIds = await ensureTabs(accessToken, spreadsheetId, tabs);
  await writeSpreadsheet(accessToken, spreadsheetId, tabs, [
    ...buildWinnerSheetFormat(tabIds, data),
    ...buildColumnWidthRequests(tabIds, tabs),
  ]);
  const { failedEditors } = await shareSpreadsheet(
    accessToken,
    spreadsheetId,
    connection?.editorEmails ?? [],
  );

  const persisted = await persist({
    organizationId,
    connectionId,
    spreadsheetId,
    url,
    rowCount: data.rows.length,
    userId,
    raffles: group.raffles.map(({ id, kind }) => ({ id, kind })),
  });

  return {
    spreadsheetId: persisted.spreadsheetId,
    url: persisted.spreadsheetUrl,
    rowCount: persisted.rowCount,
    syncedAt: persisted.syncedAt.toISOString(),
    raffleIds: group.raffles.map((raffle) => raffle.id),
    missingRaffleIds: [],
    stale: false,
    created,
    rewritten: !created,
    duplicatesRemoved: data.duplicatesRemoved,
    blocks: data.countsByKind.map(({ kind, rows }) => ({ kind, rows })),
    failedEditors,
  };
}

/** Re-add a tab a person deleted, so a rewrite still has somewhere to land. */
async function ensureTabs(
  accessToken: string,
  spreadsheetId: string,
  tabs: SheetTab[],
): Promise<Map<string, number>> {
  let tabIds = await spreadsheetTabIds(accessToken, spreadsheetId);
  const missing = tabs.filter((tab) => !tabIds.has(tab.title));
  if (missing.length === 0) return tabIds;

  await writeSpreadsheet(
    accessToken,
    spreadsheetId,
    [],
    missing.map((tab) => ({
      addSheet: {
        properties: {
          title: tab.title,
          gridProperties: { frozenRowCount: tab.frozenRows ?? 0 },
        },
      },
    })),
  );
  tabIds = await spreadsheetTabIds(accessToken, spreadsheetId);
  return tabIds;
}

async function persist(input: {
  organizationId: string;
  connectionId: string;
  spreadsheetId: string;
  url: string;
  rowCount: number;
  userId: string;
  raffles: { id: number; kind: WinnerListKind }[];
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const sheet = await tx.winnerSheet.upsert({
        where: { spreadsheetId: input.spreadsheetId },
        create: {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          spreadsheetId: input.spreadsheetId,
          spreadsheetUrl: input.url,
          rowCount: input.rowCount,
          createdById: input.userId,
        },
        update: {
          rowCount: input.rowCount,
          syncedAt: new Date(),
          connectionId: input.connectionId,
        },
      });
      for (const raffle of input.raffles) {
        await tx.winnerSheetRaffle.upsert({
          where: { raffleId: raffle.id },
          create: { sheetId: sheet.id, raffleId: raffle.id, kind: raffle.kind },
          update: { sheetId: sheet.id, kind: raffle.kind },
        });
      }
      return sheet;
    });
  } catch (err) {
    // Two people clicking at once: the loser's raffle link collides with the
    // winner's. Hand back the sheet that landed rather than failing — the
    // extra spreadsheet is left unreferenced in Drive.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const link = await prisma.winnerSheetRaffle.findFirst({
        where: { raffleId: { in: input.raffles.map((raffle) => raffle.id) } },
        include: { sheet: true },
      });
      if (link) return link.sheet;
    }
    throw err;
  }
}

export const WINNER_SHEET_TABS = [WINNERS_TAB, ADDRESSES_TAB] as const;
