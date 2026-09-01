type TelegramLogLevel = "info" | "warn" | "error";

export function telegramLog(
  level: TelegramLogLevel,
  event: string,
  context: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const entry = JSON.stringify({
    level,
    service: "kos-telegram-bot",
    event,
    timestamp: new Date().toISOString(),
    ...context,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
