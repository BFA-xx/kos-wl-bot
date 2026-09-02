import { type Bot, type Context, InlineKeyboard } from "grammy";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { prisma } from "@/lib/db";

const PREFERENCE_KEYS = [
  "announcements",
  "raffleReminders",
  "winners",
  "points",
  "community",
] as const;
type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

const LABELS: Record<PreferenceKey, string> = {
  announcements: "Announcements",
  raffleReminders: "Raffle reminders",
  winners: "Winner updates",
  points: "Points updates",
  community: "Community updates",
};

export async function showTelegramNotificationPreferences(
  ctx: Context,
  edit = false,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply(
      "Open notification settings in a private chat with KOS Bot.",
    );
    return;
  }
  const identity = await ensureTelegramIdentity(ctx.from);
  const preferences = await prisma.kosNotificationPreference.upsert({
    where: { identityId: identity.id },
    create: { identityId: identity.id },
    update: {},
  });
  const keyboard = new InlineKeyboard();
  for (const key of PREFERENCE_KEYS) {
    keyboard
      .text(
        `${preferences[key] ? "On" : "Off"}: ${LABELS[key]}`,
        `notify:${key}`,
      )
      .row();
  }
  keyboard.text("Back", "nav:menu");
  const options = { reply_markup: keyboard };
  if (edit && ctx.callbackQuery?.message) {
    await ctx
      .editMessageText("KOS notification preferences", options)
      .catch(async () => ctx.reply("KOS notification preferences", options));
    return;
  }
  await ctx.reply("KOS notification preferences", options);
}

export function registerTelegramNotificationHandlers(bot: Bot): void {
  bot.command("notifications", (ctx) =>
    showTelegramNotificationPreferences(ctx),
  );
  bot.callbackQuery("nav:notifications", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTelegramNotificationPreferences(ctx, true);
  });
  bot.callbackQuery(
    /^notify:(announcements|raffleReminders|winners|points|community)$/u,
    async (ctx) => {
      if (!ctx.from || ctx.chat?.type !== "private") return;
      const key = ctx.match[1] as PreferenceKey;
      const identity = await ensureTelegramIdentity(ctx.from);
      const current = await prisma.kosNotificationPreference.upsert({
        where: { identityId: identity.id },
        create: { identityId: identity.id },
        update: {},
      });
      await prisma.kosNotificationPreference.update({
        where: { identityId: identity.id },
        data: { [key]: !current[key] },
      });
      await ctx.answerCallbackQuery({ text: `${LABELS[key]} updated.` });
      await showTelegramNotificationPreferences(ctx, true);
    },
  );
}
