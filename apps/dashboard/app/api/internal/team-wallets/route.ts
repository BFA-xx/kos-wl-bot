import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { TeamWalletSelectionMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/access";
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

/**
 * Team Wallet Pool fills driven from Discord.
 *
 * The bot has already checked the caller is a raffle manager for the guild;
 * this re-checks the raffle really belongs to that guild and shares the
 * reservation transaction with the dashboard rather than reimplementing it.
 */
export async function POST(req: Request) {
  const token = process.env.BOT_API_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "confirm" ? "confirm" : "preview";
  const raffleId = Number(body.raffleId);
  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const actorId = typeof body.actorId === "string" ? body.actorId : "";
  if (!Number.isSafeInteger(raffleId) || !guildId || !actorId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const rawMode = String(body.selectionMode ?? "") as TeamWalletSelectionMode;
  const selectionMode = MODES.has(rawMode) ? rawMode : null;
  if (body.selectionMode !== undefined && !selectionMode) {
    return NextResponse.json(
      { error: "Unknown selection mode." },
      { status: 400 },
    );
  }
  const count =
    body.count === undefined || body.count === null ? null : Number(body.count);
  if (count !== null && (!Number.isInteger(count) || count < 1)) {
    return NextResponse.json(
      { error: "Team wallet count must be a positive whole number." },
      { status: 400 },
    );
  }

  const connection = await prisma.guildConnection.findUnique({
    where: { guildId },
    select: {
      organization: { select: { id: true, suspendedAt: true } },
    },
  });
  const organization = connection?.organization;
  if (!organization) {
    return NextResponse.json(
      { error: "This server is not connected to a KOS organization." },
      { status: 404 },
    );
  }
  if (organization.suspendedAt) {
    return NextResponse.json(
      { error: "organization_suspended" },
      { status: 403 },
    );
  }

  // Scope to the calling guild alone: a manager in one connected server must
  // not reserve wallets against a raffle that ran in a different one.
  const identity = {
    organizationId: organization.id,
    guildIds: [guildId],
    raffleId,
  };

  try {
    if (action === "preview") {
      return NextResponse.json(
        await previewTeamWalletFill(identity, count, selectionMode),
      );
    }
    if (count === null || !selectionMode) {
      return NextResponse.json(
        { error: "A count and selection mode are required to confirm." },
        { status: 400 },
      );
    }
    const result = await commitTeamWalletFill({
      ...identity,
      count,
      selectionMode,
      userId: actorId,
    });
    await logAudit(organization.id, actorId, "RAFFLE_TEAM_WALLETS_FILLED", {
      targetType: "raffle",
      targetId: String(raffleId),
      metadata: {
        source: "discord",
        selected: result.selected,
        community: result.community,
        remaining: result.remaining,
        selectionMode: result.mode,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TeamWalletFillError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("internal team wallet fill error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function authorized(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
