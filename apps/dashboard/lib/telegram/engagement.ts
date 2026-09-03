import { type Bot, type Context, type NextFunction } from "grammy";
import { prisma } from "@/lib/db";
import { consumeTelegramRateLimit } from "@/lib/telegram/rate-limit";

const USER_GREETING_LIMIT = 2;
const CHAT_GREETING_LIMIT = 15;
const GREETING_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:gm|gkos)(?=$|[^\p{L}\p{N}_])/iu;

export function containsKosGreeting(text: string): boolean {
  return !text.trimStart().startsWith("/") && GREETING_PATTERN.test(text);
}

export async function handleKosGreeting(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const text = ctx.message?.text;
  if (
    !ctx.from ||
    ctx.from.is_bot ||
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type) ||
    !text ||
    !containsKosGreeting(text)
  ) {
    await next();
    return;
  }

  const community = await prisma.telegramCommunity.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
    select: { status: true, featureFlags: true },
  });
  if (
    !community ||
    community.status !== "ACTIVE" ||
    !community.featureFlags.includes("GREETINGS")
  ) {
    await next();
    return;
  }

  const now = new Date();
  const [userAllowed, chatAllowed] = await Promise.all([
    consumeTelegramRateLimit(
      String(ctx.from.id),
      `greeting:${ctx.chat.id}`,
      now,
      USER_GREETING_LIMIT,
    ),
    consumeTelegramRateLimit(
      `chat:${ctx.chat.id}`,
      "greeting",
      now,
      CHAT_GREETING_LIMIT,
    ),
  ]);
  if (!userAllowed || !chatAllowed) return;

  await ctx.reply("gKOS🖤", {
    reply_parameters: {
      message_id: ctx.message.message_id,
      allow_sending_without_reply: true,
    },
  });
}

export function registerTelegramEngagementHandlers(bot: Bot): void {
  bot.on("message:text", handleKosGreeting);
}
