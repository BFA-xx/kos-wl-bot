import { config as loadEnv } from "dotenv";

loadEnv({ path: "../../.env" });
loadEnv({ path: ".env.local", override: true });

const [{ buildTelegramBot }, { telegramConfig }, { telegramLog }] =
  await Promise.all([
    import("@/lib/telegram-bot"),
    import("@/lib/telegram"),
    import("@/lib/telegram/log"),
  ]);

if (process.env.NODE_ENV === "production") {
  throw new Error("Local Telegram polling is disabled in production");
}
if (process.env.TELEGRAM_LOCAL_POLLING !== "true") {
  throw new Error("Set TELEGRAM_LOCAL_POLLING=true to enable local polling");
}

const { botToken, webhookSecret } = telegramConfig();
if (!botToken) throw new Error("Telegram bot token is not configured");

const bot = buildTelegramBot(botToken);
let stopping = false;

async function restoreWebhook(): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL?.trim();
  if (!webhookUrl || !webhookSecret) return;
  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query", "chat_member"],
  });
  telegramLog("info", "local_polling_webhook_restored");
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  telegramLog("info", "local_polling_stopping", { signal });
  await bot.stop();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  telegramLog("info", "local_polling_started");
  await bot.start({
    allowed_updates: ["message", "callback_query", "chat_member"],
  });
} finally {
  await restoreWebhook();
}
