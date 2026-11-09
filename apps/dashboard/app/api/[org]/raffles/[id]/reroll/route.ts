import { parseRerollOptions, raffleManualReplacementWhere } from "@kos/db";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess, logAudit } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parsePublicRaffleId } from "@/lib/raffle-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: { org: string; id: string } };

async function getRerollContext(params: RouteContext["params"]) {
  const { org, user, guildIds } = await requireOrgAccess(
    params.org,
    PERMISSIONS.RAFFLE_REROLL,
  );
  const id = parsePublicRaffleId(params.id);
  if (!id) throw new AccessError(400, "Invalid raffle ID.");
  const raffle = await prisma.raffle.findFirst({
    where: { id, guildId: { in: guildIds } },
    select: {
      id: true,
      guildId: true,
      status: true,
      holdResults: true,
      resultsPublishedAt: true,
    },
  });
  if (!raffle) throw new AccessError(404, "Raffle not found.");
  if (raffle.status !== "ENDED") {
    throw new AccessError(400, "Raffle must be ended before rerolling.");
  }
  if (!raffle.holdResults && !raffle.resultsPublishedAt) {
    throw new AccessError(
      409,
      "Wait for the initial draw to publish before rerolling.",
    );
  }
  return { org, user, raffle };
}

/** Enough to scroll a typical raffle; larger ones are narrowed by search. */
const ENTRANT_PAGE = 200;

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { raffle } = await getRerollContext(params);
    const query = new URL(req.url).searchParams.get("q")?.trim().slice(0, 128);
    const entrants = await prisma.participant.findMany({
      where: {
        ...raffleManualReplacementWhere(raffle.id, raffle.guildId),
        ...(query
          ? {
              OR: [
                { username: { contains: query, mode: "insensitive" } },
                { userId: query },
              ],
            }
          : {}),
      },
      select: { userId: true, username: true },
      orderBy: [{ username: "asc" }, { userId: "asc" }],
      take: ENTRANT_PAGE + 1,
    });
    return NextResponse.json({
      entrants: entrants.slice(0, ENTRANT_PAGE),
      truncated: entrants.length > ENTRANT_PAGE,
    });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Couldn't load entrants." },
      { status: 500 },
    );
  }
}

/** Queue a reroll for the bot scheduler. */
export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { org, user, raffle } = await getRerollContext(params);
    const { id, guildId } = raffle;
    const options = parseRerollOptions(await req.json().catch(() => null));
    if (!options) {
      return NextResponse.json(
        { error: "Invalid reroll selection." },
        { status: 400 },
      );
    }

    if (options.mode === "manual") {
      const [winner, replacement] = await Promise.all([
        prisma.winner.findFirst({
          where: {
            raffleId: id,
            userId: options.winnerUserId,
            replaced: false,
          },
          select: { id: true },
        }),
        prisma.participant.findFirst({
          where: {
            ...raffleManualReplacementWhere(id, guildId),
            userId: options.replacementUserId,
          },
          select: { id: true },
        }),
      ]);
      if (!winner || !replacement) {
        return NextResponse.json(
          {
            error:
              "Choose a current winner and an eligible entrant who is not already a winner.",
          },
          { status: 409 },
        );
      }
    }

    const queued = await prisma.raffle.updateMany({
      where: {
        id,
        guildId,
        status: "ENDED",
        rerollRequestedAt: null,
        resultsPublishRequestedAt: null,
      },
      data: {
        rerollRequest: { ...options, actorId: user.id },
        rerollRequestedAt: new Date(),
      },
    });
    if (!queued.count) {
      return NextResponse.json(
        {
          error:
            "The raffle changed or a result action is already queued. Refresh and try again.",
        },
        { status: 409 },
      );
    }
    await logAudit(
      org.id,
      user.id,
      options.mode === "manual"
        ? "RAFFLE_MANUAL_REROLL_REQUEST"
        : "RAFFLE_REROLL",
      { targetType: "raffle", targetId: String(id), metadata: options },
    );
    return NextResponse.json({ ok: true, queued: true });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
