import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/access";
import {
  accessTokenForOrg,
  createSpreadsheet,
  shareSpreadsheet,
  writeSpreadsheet,
} from "@/lib/google";
import {
  buildRaffleReportTab,
  buildRaffleReportFormat,
  type RaffleReportType,
} from "@/lib/raffle-report";
import {
  ADDRESSES_TAB,
  buildColumnWidthRequests,
  buildWinnerSheetTabs,
  collectWinnerSheetRows,
  resolveWinnerSheetGroup,
} from "@/lib/winner-sheet";

import { exportHeading } from "@/lib/export-heading";
import { WinnerSheetError } from "@/lib/winner-sheet-sync";

export async function syncRaffleReport({
  organizationId,
  communityName,
  userId,
  guildIds,
  id,
  type,
}: {
  organizationId: string;
  communityName: string;
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
  let projectName = raffle.projectName;
  let raffleIds = [id];
  let rowCount = 0;
  if (type === "participants") {
    const participants = await prisma.participant.findMany({
      where: { raffleId: id },
      orderBy: { enteredAt: "asc" },
    });
    tab = buildRaffleReportTab(type, [], participants);
    rowCount = participants.length;
  } else {
    const group = await resolveWinnerSheetGroup(id, guildIds);
    if (!group) throw new WinnerSheetError(404, "Raffle not found.");
    const data = await collectWinnerSheetRows(group);
    rowCount = data.rows.length;
    projectName = group.raffles[0]?.projectName ?? group.projectName;
    raffleIds = group.raffles.map((raffle) => raffle.id);
    tab =
      type === "addresses"
        ? buildWinnerSheetTabs(
            exportHeading(communityName, group.projectName),
            data,
          ).find((sheet) => sheet.title === ADDRESSES_TAB)!
        : buildRaffleReportTab(type, data.rows);
  }
  // Both GTD and FCFS open the same snapshot for the combined group.
  const reportId = raffleIds[0] ?? id;

  const { accessToken, connectionId } = await accessTokenForOrg(organizationId);
  const connection = await prisma.googleConnection.findUnique({
    where: { id: connectionId },
    select: { editorEmails: true, googleUserId: true },
  });
  // Reuse the snapshot when the source data is unchanged. Never overwrite team edits.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        connection?.googleUserId,
        exportHeading(communityName, projectName),
        tab,
      ]),
    )
    .digest("hex");
  const action = `raffle_report.${type}`;
  const previous = await prisma.auditLog.findFirst({
    where: {
      organizationId: organizationId,
      action,
      targetType: "raffle",
      targetId: String(reportId),
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
      `${exportHeading(communityName, projectName)} — ${tab.title} ${raffleIds.map((id) => `#${id}`).join(" + ")}`,
      [tab],
    );
    spreadsheetId = created.spreadsheetId;
    url = created.spreadsheetUrl;
    await writeSpreadsheet(
      accessToken,
      spreadsheetId,
      [tab],
      [
        ...buildColumnWidthRequests(new Map([[tab.title, 0]]), [tab]),
        ...buildRaffleReportFormat(tab, 0),
      ],
    );
    await logAudit(organizationId, userId, action, {
      targetType: "raffle",
      targetId: String(reportId),
      metadata: { fingerprint, spreadsheetId, url, raffleIds },
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
    raffleIds,
    failedEditors,
    rowCount,
  };
}
