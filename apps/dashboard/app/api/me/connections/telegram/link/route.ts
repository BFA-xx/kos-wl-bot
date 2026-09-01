import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hashIntegrationToken, callTelegramApi } from "@kos/db";
import { prisma } from "@/lib/db";
import { AccessError, requireUser } from "@/lib/access";
import { telegramConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await requireUser();
    const { botToken, botUsername } = telegramConfig();
    if (!botToken) {
      return NextResponse.json(
        { error: "Telegram linking is not configured yet." },
        { status: 503 },
      );
    }
    let username = botUsername;
    if (!username) {
      const me = await callTelegramApi<{ username?: string }>(
        botToken,
        "getMe",
      );
      username = me.ok ? (me.result?.username ?? null) : null;
    }
    if (!username) {
      return NextResponse.json(
        { error: "Telegram bot identity is unavailable." },
        { status: 503 },
      );
    }

    const secret = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await prisma.$transaction([
      prisma.integrationActionToken.deleteMany({
        where: {
          action: "TELEGRAM_LINK",
          userId: user.id,
          consumedAt: null,
        },
      }),
      prisma.integrationActionToken.create({
        data: {
          action: "TELEGRAM_LINK",
          userId: user.id,
          tokenHash: hashIntegrationToken(secret),
          expiresAt,
        },
      }),
    ]);
    return NextResponse.json({
      url: `https://t.me/${username}?start=link_${secret}`,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Telegram link start failed", error);
    return NextResponse.json(
      { error: "Could not start Telegram linking." },
      { status: 500 },
    );
  }
}
