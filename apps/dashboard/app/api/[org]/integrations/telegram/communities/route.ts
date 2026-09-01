import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AccessError, logAudit, requireOrgAccess } from "@/lib/access";
import { PERMISSIONS } from "@/lib/permissions";
import {
  normalizeTelegramChatId,
  TELEGRAM_FEATURE_FLAGS,
  verifyTelegramCommunity,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { org: string } },
) {
  try {
    const { org, guildIds } = await requireOrgAccess(params.org);
    const [communities, guilds] = await Promise.all([
      prisma.telegramCommunity.findMany({
        where: { organizationId: org.id },
        orderBy: [{ status: "asc" }, { communityName: "asc" }],
        include: { _count: { select: { publications: true } } },
      }),
      prisma.guild.findMany({
        where: { id: { in: guildIds } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return NextResponse.json({ communities, guilds });
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
  { params }: { params: { org: string } },
) {
  try {
    const { org, user, guildIds } = await requireOrgAccess(
      params.org,
      PERMISSIONS.SETTINGS_EDIT,
    );
    const body = await request.json().catch(() => ({}));
    const telegramChatId = normalizeTelegramChatId(body.telegramChatId);
    const backingGuildId = String(body.backingGuildId ?? "");
    if (!telegramChatId || !guildIds.includes(backingGuildId)) {
      return NextResponse.json(
        {
          error:
            "Choose a connected Discord server and enter a valid Telegram chat ID.",
        },
        { status: 400 },
      );
    }
    const verified = await verifyTelegramCommunity(telegramChatId);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 409 });
    }
    const featureFlags = Array.isArray(body.featureFlags)
      ? body.featureFlags.filter((flag: unknown): flag is string =>
          TELEGRAM_FEATURE_FLAGS.includes(
            flag as (typeof TELEGRAM_FEATURE_FLAGS)[number],
          ),
        )
      : ["AUTO_ANNOUNCEMENTS", "MEMBERSHIP_CHECKS"];
    const community = await prisma.telegramCommunity.create({
      data: {
        organizationId: org.id,
        backingGuildId,
        telegramChatId,
        communityName:
          String(body.communityName ?? "")
            .trim()
            .slice(0, 120) ||
          verified.name ||
          telegramChatId,
        featureFlags,
        permissions: [],
        defaultRaffleSettings: {
          membershipRequired: false,
          remainUntilEnd: false,
          winnerVisibility: "PUBLIC",
          autoAnnouncements: true,
        },
        botVerifiedAt: new Date(),
        createdById: user.id,
      },
    });
    await logAudit(org.id, user.id, "TELEGRAM_COMMUNITY_CONNECT", {
      targetType: "telegram_community",
      targetId: community.id,
      metadata: { telegramChatId, backingGuildId },
    });
    return NextResponse.json({ community }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That Telegram chat is already connected." },
        { status: 409 },
      );
    }
    console.error("Telegram community connect failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
