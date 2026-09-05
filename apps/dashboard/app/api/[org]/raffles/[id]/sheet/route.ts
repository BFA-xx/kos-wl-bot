import { NextResponse, type NextRequest } from "next/server";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { GoogleError } from "@/lib/google";
import {
  WinnerSheetError,
  syncWinnerSheet,
  winnerSheetState,
} from "@/lib/winner-sheet-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Whether this raffle already has a sheet, and whether it has gone stale. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.WALLET_EXPORT,
    );
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad raffle id." }, { status: 400 });
    }
    return NextResponse.json({ sheet: await winnerSheetState(id, guildIds) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Open the winners sheet, creating it on first use. `rewrite` replaces the
 * sheet's contents from the raffle — used after a reroll or a team-wallet
 * fill, and it discards whatever the team edited in place.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.WALLET_EXPORT,
    );
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad raffle id." }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { rewrite?: unknown };
    const rewrite = body.rewrite === true;

    const result = await syncWinnerSheet({
      organizationId: org.id,
      guildIds,
      raffleId: id,
      userId: user.id,
      rewrite,
    });

    if (result.created || result.rewritten) {
      await logAudit(
        org.id,
        user.id,
        result.created ? "winner_sheet.created" : "winner_sheet.rewritten",
        {
          targetType: "raffle",
          targetId: String(id),
          metadata: {
            spreadsheetId: result.spreadsheetId,
            rows: result.rowCount,
            raffleIds: result.raffleIds,
          },
        },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof AccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Google's own message is the useful one here ("connect an account",
  // "access revoked"), so it is passed through rather than flattened to 500.
  if (err instanceof GoogleError || err instanceof WinnerSheetError) {
    return NextResponse.json(
      { error: err.message },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
  console.error("winner sheet error", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
