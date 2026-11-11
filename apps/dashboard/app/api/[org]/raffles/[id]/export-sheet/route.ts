import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  GoogleError,
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const body = await req.json().catch(() => ({}));
    if (
      !["addresses", "full", "winners", "participants"].includes(body?.type)
    ) {
      return NextResponse.json(
        { error: "Invalid report type." },
        { status: 400 },
      );
    }
    const type = body.type as RaffleReportType;
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      type === "participants"
        ? PERMISSIONS.REPORT_EXPORT
        : PERMISSIONS.WALLET_EXPORT,
    );
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id <= 0)
      return NextResponse.json({ error: "Bad raffle id." }, { status: 400 });
    const raffle = await prisma.raffle.findFirst({
      where: { id, guildId: { in: guildIds } },
      select: { projectName: true, walletChains: true },
    });
    if (!raffle)
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });

    let tab;
    if (type === "addresses") {
      const group = await resolveWinnerSheetGroup(id, guildIds);
      if (!group)
        return NextResponse.json(
          { error: "Raffle not found." },
          { status: 404 },
        );
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

    const { accessToken, connectionId } = await accessTokenForOrg(org.id);
    const connection = await prisma.googleConnection.findUnique({
      where: { id: connectionId },
      select: { editorEmails: true, googleUserId: true },
    });
    // Reuse the snapshot when the source data is unchanged. Never overwrite team edits.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([connection?.googleUserId, raffle.projectName, tab]),
      )
      .digest("hex");
    const action = `raffle_report.${type}`;
    const previous = await prisma.auditLog.findFirst({
      where: {
        organizationId: org.id,
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
      await logAudit(org.id, user.id, action, {
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
    return NextResponse.json({ url, failedEditors });
  } catch (error) {
    if (error instanceof AccessError || error instanceof GoogleError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("raffle report sheet error", error);
    return NextResponse.json(
      { error: "Couldn't open the Google Sheet." },
      { status: 500 },
    );
  }
}
