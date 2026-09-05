import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/access";
import { GoogleError } from "@/lib/google";
import { WinnerSheetError, syncWinnerSheet } from "@/lib/winner-sheet-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Winner sheet for the Discord bot.
 *
 * `/raffle export` runs on the bot, which has no Google credentials of its
 * own — it calls in here with a shared secret so a manager gets a sheet link
 * straight from Discord without opening the dashboard first. The bot has
 * already checked that the caller is a raffle manager for the guild; this
 * route re-checks that the raffle really belongs to that guild.
 */
export async function POST(req: Request) {
  const token = process.env.BOT_API_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    raffleId?: unknown;
    guildId?: unknown;
    actorId?: unknown;
    rewrite?: unknown;
  };
  const raffleId = Number(body.raffleId);
  const guildId = typeof body.guildId === "string" ? body.guildId : "";
  const actorId = typeof body.actorId === "string" ? body.actorId : "";
  if (!Number.isSafeInteger(raffleId) || !guildId || !actorId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const connection = await prisma.guildConnection.findUnique({
    where: { guildId },
    select: {
      organization: {
        select: {
          id: true,
          suspendedAt: true,
          guildConnections: { select: { guildId: true } },
        },
      },
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

  try {
    const result = await syncWinnerSheet({
      organizationId: organization.id,
      // Scope to the calling guild alone: a manager in one connected server
      // must not pull a sheet for a raffle that ran in a different one.
      guildIds: [guildId],
      raffleId,
      userId: actorId,
      rewrite: body.rewrite === true,
    });
    if (result.created || result.rewritten) {
      await logAudit(
        organization.id,
        actorId,
        result.created ? "winner_sheet.created" : "winner_sheet.rewritten",
        {
          targetType: "raffle",
          targetId: String(raffleId),
          metadata: { source: "discord", spreadsheetId: result.spreadsheetId },
        },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GoogleError || err instanceof WinnerSheetError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("internal winner sheet error", err);
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
