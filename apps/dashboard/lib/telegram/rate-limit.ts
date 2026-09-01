import type { Context, NextFunction } from "grammy";
import { prisma } from "@/lib/db";

const WINDOW_MS = 60_000;
const INTERACTION_LIMIT = 30;

export function telegramRateWindowStart(now: Date, windowMs = WINDOW_MS): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export async function consumeTelegramRateLimit(
  telegramUserId: string,
  scope = "interaction",
  now = new Date(),
): Promise<boolean> {
  const windowStart = telegramRateWindowStart(now);
  const bucket = await prisma.telegramRateLimitBucket.upsert({
    where: {
      telegramUserId_scope_windowStart: {
        telegramUserId,
        scope,
        windowStart,
      },
    },
    create: { telegramUserId, scope, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  if (bucket.count === 1 && now.getUTCMinutes() === 0) {
    await prisma.telegramRateLimitBucket.deleteMany({
      where: {
        windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
    });
  }
  return bucket.count <= INTERACTION_LIMIT;
}

export async function telegramRateLimitMiddleware(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  if (!ctx.from || ctx.update.chat_member) {
    await next();
    return;
  }
  const allowed = await consumeTelegramRateLimit(String(ctx.from.id));
  if (allowed) {
    await next();
    return;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: "Too many requests. Please wait a minute.",
      show_alert: true,
    });
    return;
  }
  await ctx.reply("Too many requests. Please wait a minute.");
}
