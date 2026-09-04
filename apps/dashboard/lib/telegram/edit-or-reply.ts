import { GrammyError, type Context } from "grammy";

/**
 * Re-render an inline screen in place.
 *
 * Every screen here used `editMessageText(...).catch(() => ctx.reply(...))`,
 * which quietly turned the most ordinary case into a bug: pressing Refresh
 * when nothing had changed made Telegram answer "message is not modified", the
 * catch treated that as failure, and the bot posted a duplicate of the screen
 * the member was already looking at.
 *
 * An unchanged message means the screen is already correct, so there is
 * nothing to do. Only a genuine failure — the message is too old to edit, or
 * was deleted — deserves a fresh one.
 */

export function isUnchangedMessage(error: unknown): boolean {
  const description =
    error instanceof GrammyError
      ? error.description
      : error instanceof Error
        ? error.message
        : "";
  return /message is not modified/iu.test(description);
}

type EditOptions = NonNullable<Parameters<Context["editMessageText"]>[1]>;
type ReplyOptions = NonNullable<Parameters<Context["reply"]>[1]>;

export async function editOrReply(
  ctx: Context,
  text: string,
  options: EditOptions & ReplyOptions,
  /** False when the caller knows this is a fresh screen, not a re-render. */
  edit = true,
): Promise<void> {
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      if (isUnchangedMessage(error)) return;
    }
  }
  await ctx.reply(text, options);
}
