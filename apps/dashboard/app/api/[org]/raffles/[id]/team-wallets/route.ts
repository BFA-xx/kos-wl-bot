import { NextResponse } from "next/server";
import { type TeamWalletSelectionMode } from "@prisma/client";
import { logAudit, requireOrgAccess, withAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  TeamWalletFillError,
  commitTeamWalletFill,
  previewTeamWalletFill,
} from "@/lib/team-wallet-fill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<TeamWalletSelectionMode>([
  "ROUND_ROBIN",
  "RANDOM",
  "PRIORITY",
]);

function requestedSelectionMode(value: unknown) {
  const mode = String(value ?? "") as TeamWalletSelectionMode;
  return mode && MODES.has(mode) ? mode : null;
}

function fillError(err: unknown) {
  if (err instanceof TeamWalletFillError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export const GET = withAccess(async (request, { params }) => {
  const { org, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.TEAM_WALLET_FILL,
  );
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const url = new URL(request.url);
  const modeParam = url.searchParams.get("selectionMode");
  const countParam = url.searchParams.get("count");
  const requestedMode = modeParam ? requestedSelectionMode(modeParam) : null;
  if (modeParam && !requestedMode) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const requestedCount = countParam === null ? null : Number(countParam);
  if (
    requestedCount !== null &&
    (!Number.isInteger(requestedCount) || requestedCount < 1)
  ) {
    return NextResponse.json(
      { error: "Team wallet count must be a positive whole number." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await previewTeamWalletFill(
        { organizationId: org.id, guildIds, raffleId },
        requestedCount,
        requestedMode,
      ),
    );
  } catch (err) {
    return fillError(err);
  }
});

interface RequestedWallet {
  id: string;
  version: string;
}

export const POST = withAccess(async (request, { params }) => {
  const { org, user, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.TEAM_WALLET_FILL,
  );
  const raffleId = Number(params.id);
  if (!Number.isInteger(raffleId)) {
    return NextResponse.json({ error: "Invalid raffle ID." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const requestedMode = requestedSelectionMode(body.selectionMode);
  if (!requestedMode) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const count = Number(body.count);
  const requestedWallets: RequestedWallet[] = Array.isArray(body.wallets)
    ? body.wallets.map((wallet: unknown) => {
        const value = wallet as Record<string, unknown>;
        return {
          id: String(value.id ?? ""),
          version: String(value.version ?? ""),
        };
      })
    : [];
  const uniqueIds = new Set(requestedWallets.map((wallet) => wallet.id));
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    requestedWallets.length !== count ||
    uniqueIds.size !== count ||
    requestedWallets.some((wallet) => !wallet.id || !wallet.version)
  ) {
    return NextResponse.json(
      { error: "Preview the requested number of wallets before confirming." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await commitTeamWalletFill({
      organizationId: org.id,
      guildIds,
      raffleId,
      count,
      selectionMode: requestedMode,
      userId: user.id,
      expectedWallets: requestedWallets,
    });
  } catch (err) {
    return fillError(err);
  }

  await logAudit(org.id, user.id, "RAFFLE_TEAM_WALLETS_FILLED", {
    targetType: "raffle",
    targetId: String(raffleId),
    metadata: {
      selected: result.selected,
      community: result.community,
      remaining: result.remaining,
      selectionMode: result.mode,
    },
  });
  return NextResponse.json({
    ok: true,
    selected: result.selected,
    remaining: result.remaining,
    selectionMode: result.mode,
  });
});
