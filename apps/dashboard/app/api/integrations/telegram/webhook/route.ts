import { NextResponse } from "next/server";
import type { Update } from "grammy/types";
import { prisma } from "@/lib/db";
import { handleTelegramUpdate } from "@/lib/telegram-bot";
import { secureStringEqual, telegramConfig } from "@/lib/telegram";
import { telegramLog } from "@/lib/telegram/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function claimUpdate(updateId: number): Promise<boolean> {
  const inserted = await prisma.telegramUpdateReceipt.createMany({
    data: [{ botKey: "main", updateId }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return true;
  const staleBefore = new Date(Date.now() - 30_000);
  const resumed = await prisma.telegramUpdateReceipt.updateMany({
    where: {
      botKey: "main",
      updateId,
      OR: [
        { status: "FAILED" },
        { status: "RECEIVED", receivedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "RECEIVED", receivedAt: new Date(), error: null },
  });
  return resumed.count === 1;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { botToken, webhookSecret } = telegramConfig();
  if (!botToken || !webhookSecret) {
    return NextResponse.json(
      { error: "telegram_not_configured" },
      { status: 503 },
    );
  }
  const presented = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secureStringEqual(presented, webhookSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 1_000_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const update = (await request.json().catch(() => null)) as Update | null;
  if (!update || !Number.isInteger(update.update_id)) {
    return NextResponse.json({ error: "invalid_update" }, { status: 400 });
  }
  const claimed = await claimUpdate(update.update_id);
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });
  try {
    await handleTelegramUpdate(update);
    await prisma.telegramUpdateReceipt.update({
      where: {
        botKey_updateId: { botKey: "main", updateId: update.update_id },
      },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });
    telegramLog("info", "webhook_update_processed", {
      requestId: `tg:${update.update_id}`,
      updateId: update.update_id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
    await prisma.telegramUpdateReceipt.update({
      where: {
        botKey_updateId: { botKey: "main", updateId: update.update_id },
      },
      data: { status: "FAILED", error: message },
    });
    telegramLog("error", "webhook_update_failed", {
      requestId: `tg:${update.update_id}`,
      updateId: update.update_id,
      error: message,
    });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
