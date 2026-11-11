import { NextResponse, type NextRequest } from "next/server";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { GoogleError } from "@/lib/google";
import { WinnerSheetError } from "@/lib/winner-sheet-sync";
import { syncRaffleReport } from "@/lib/raffle-report-sync";
import type { RaffleReportType } from "@/lib/raffle-report";

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
    const result = await syncRaffleReport({
      organizationId: org.id,
      userId: user.id,
      guildIds,
      id,
      type,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof AccessError ||
      error instanceof GoogleError ||
      error instanceof WinnerSheetError
    )
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
