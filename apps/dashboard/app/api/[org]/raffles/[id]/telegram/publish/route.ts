import { NextResponse } from "next/server";
import type { TelegramWinnerVisibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import { parsePublicRaffleId } from "@/lib/raffle-share";
import { publishRaffleToTelegram } from "@/lib/telegram-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VISIBILITY = new Set<TelegramWinnerVisibility>([
  "PUBLIC",
  "ANONYMOUS",
  "ADMIN_ONLY",
]);

export async function GET(
  _request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, guildIds } = await requireOrgAccess(params.org);
    const raffleId = parsePublicRaffleId(params.id);
    if (!raffleId)
      return NextResponse.json(
        { error: "Invalid raffle ID." },
        { status: 400 },
      );
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, guildId: { in: guildIds } },
      select: { id: true },
    });
    if (!raffle)
      return NextResponse.json({ error: "Raffle not found." }, { status: 404 });
    const [communities, publications] = await Promise.all([
      prisma.telegramCommunity.findMany({
        where: { organizationId: org.id, status: "ACTIVE" },
        orderBy: { communityName: "asc" },
      }),
      prisma.telegramRafflePublication.findMany({
        where: { raffleId },
        include: { eligibilityRules: true },
      }),
    ]);
    return NextResponse.json({ communities, publications });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { org: string; id: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.RAFFLE_EDIT,
    );
    const raffleId = parsePublicRaffleId(params.id);
    if (!raffleId)
      return NextResponse.json(
        { error: "Invalid raffle ID." },
        { status: 400 },
      );
    const body = await request.json().catch(() => ({}));
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, guildId: { in: guildIds } },
      select: { id: true, guildId: true, status: true },
    });
    const community = await prisma.telegramCommunity.findFirst({
      where: {
        id: String(body.communityId ?? ""),
        organizationId: org.id,
        status: "ACTIVE",
      },
    });
    if (!raffle || !community) {
      return NextResponse.json(
        { error: "Raffle or Telegram community not found." },
        { status: 404 },
      );
    }
    if (
      raffle.status === "CANCELLED" ||
      community.backingGuildId !== raffle.guildId
    ) {
      return NextResponse.json(
        {
          error: "This raffle cannot be published to that Telegram community.",
        },
        { status: 409 },
      );
    }
    const requestedVisibility = String(
      body.winnerVisibility ?? "PUBLIC",
    ) as TelegramWinnerVisibility;
    const publication = await publishRaffleToTelegram({
      raffleId,
      communityId: community.id,
      actorId: user.id,
      membershipRequired: body.membershipRequired === true,
      remainUntilEnd: body.remainUntilEnd === true,
      autoAnnouncements: body.autoAnnouncements !== false,
      winnerVisibility: VISIBILITY.has(requestedVisibility)
        ? requestedVisibility
        : "PUBLIC",
    });
    await logAudit(org.id, user.id, "TELEGRAM_RAFFLE_PUBLISH", {
      targetType: "raffle",
      targetId: String(raffleId),
      metadata: { communityId: community.id, publicationId: publication.id },
    });
    return NextResponse.json({ publication }, { status: 202 });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Telegram raffle publish failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
