import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/access";
import {
  accessTokenForOrg,
  createSpreadsheet,
  shareSpreadsheet,
  writeSpreadsheet,
} from "@/lib/google";
import { raffleWalletExportRows } from "@/lib/raffle-wallet-export";
import {
  buildRaffleReportTab,
  type RaffleReportType,
} from "@/lib/raffle-report";
import {
  ADDRESSES_TAB,
  buildColumnWidthRequests,
  buildWinnerSheetTabs,
  collectWinnerSheetRows,
  resolveWinnerSheetGroup,
} from "@/lib/winner-sheet";

import { WinnerSheetError } from "@/lib/winner-sheet-sync";

export async function syncRaffleReport({
  organizationId,
  userId,
  guildIds,
  id,
  type,
}: {
  organizationId: string;
  userId: string;
  guildIds: string[];
  id: number;
  type: RaffleReportType;
}) {
  const raffle = await prisma.raffle.findFirst({
    where: { id, guildId: { in: guildIds } },
    select: { projectName: true, walletChains: true },
  });
  if (!raffle) throw new WinnerSheetError(404, "Raffle not found.");

  let tab;
  if (type === "addresses") {
    const group = await resolveWinnerSheetGroup(id, guildIds);
    if (!group) throw new WinnerSheetError(404, "Raffle not found.");
    const data = await collectWinnerSheetRows(group);
    tab = buildWinnerSheetTabs(group.projectName, data).find(
      (sheet) => sheet.title === ADDRESSES_TAB,
    )!;
  } else if (type === "participants") {
    const participants = await prisma.participant.findMany({
      where: { raffleId: id },
      orderBy: { enteredAt: "asc" },
    });
    tab = buildRaffleReportTab(type, [], participants);
  } else {
    tab = buildRaffleReportTab(
      type,
      await raffleWalletExportRows(id, raffle.walletChains),
    );
  }

  const { accessToken, connectionId } = await accessTokenForOrg(organizationId);
  const connection = await prisma.googleConnection.findUnique({
    where: { id: connectionId },
    select: { editorEmails: true, googleUserId: true },
  });
  // Reuse the snapshot when the source data is unchanged. Never overwrite team edits.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([connection?.googleUserId, raffle.projectName, tab]))
    .digest("hex");
  const action = `raffle_report.${type}`;
  const previous = await prisma.auditLog.findFirst({
    where: {
      organizationId: organizationId,
      action,
      targetType: "raffle",
      targetId: String(id),
      metadata: { path: ["fingerprint"], equals: fingerprint },
    },
    orderBy: { createdAt: "desc" },
  });
  const metadata = previous?.metadata as {
    spreadsheetId?: string;
    url?: string;
  } | null;
  let spreadsheetId = metadata?.spreadsheetId;
  let url = metadata?.url;
  if (!spreadsheetId || !url) {
    const created = await createSpreadsheet(
      accessToken,
      `KOS X ${raffle.projectName} — ${tab.title} #${id}`,
      [tab],
    );
    spreadsheetId = created.spreadsheetId;
    url = created.spreadsheetUrl;
    await writeSpreadsheet(
      accessToken,
      spreadsheetId,
      [tab],
      buildColumnWidthRequests(new Map([[tab.title, 0]]), [tab]),
    );
    await logAudit(organizationId, userId, action, {
      targetType: "raffle",
      targetId: String(id),
      metadata: { fingerprint, spreadsheetId, url },
    });
  }
  // Reports include Discord identities and team details: named editors only.
  const { failedEditors } = await shareSpreadsheet(
    accessToken,
    spreadsheetId,
    connection?.editorEmails ?? [],
    false,
  );
  return {
    url,
    spreadsheetId,
    failedEditors,
    rowCount: Math.max(0, tab.rows.length - 1),
  };
}
