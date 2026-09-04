import type { Context } from "grammy";

type SendMessage = Context["api"]["sendMessage"];
type SendMessageOptions = Parameters<SendMessage>[2];

function telegramErrorDescription(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "description" in error &&
    typeof error.description === "string"
  ) {
    return error.description;
  }
  return error instanceof Error ? error.message : "";
}

export function isTelegramTopicUnavailable(error: unknown): boolean {
  return /thread not found|topic_deleted|topic_closed|topic (?:is )?closed|not a forum|topics are disabled/iu.test(
    telegramErrorDescription(error),
  );
}

/** Send into a configured forum topic, falling back only when it disappeared. */
export async function sendTelegramMessageWithTopicFallback(
  sendMessage: SendMessage,
  chatId: string | number,
  text: string,
  options: SendMessageOptions,
  topicId: number | null,
) {
  if (topicId) {
    try {
      return await sendMessage(chatId, text, {
        ...options,
        message_thread_id: topicId,
      });
    } catch (error) {
      if (!isTelegramTopicUnavailable(error)) throw error;
    }
  }
  return sendMessage(chatId, text, options);
}
