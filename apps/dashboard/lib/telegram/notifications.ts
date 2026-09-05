import { type Bot, type Context, InlineKeyboard } from "grammy";
import { ensureTelegramIdentity } from "@/lib/telegram/identity";
import { prisma } from "@/lib/db";
import { editOrReply } from "@/lib/telegram/edit-or-reply";
import {
  KOS_NOTIFICATION_KEYS as PREFERENCE_KEYS,
  KOS_NOTIFICATION_LABELS as LABELS,
  type KosNotificationKey as PreferenceKey,
} from "@/lib/kos/notifications";

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
  await editOrReply(
    ctx,
    "KOS notification preferences",
    { reply_markup: keyboard },
    edit,
  );
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
    new RegExp(`^notify:(${PREFERENCE_KEYS.join("|")})$`, "u"),
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
