export function dashboardOrigin(): string {
  const value =
    process.env.APP_URL?.trim() || process.env.DASHBOARD_URL?.trim() || "";
  if (!value) return "https://raffle.koslabs.app";
  try {
    return new URL(value).origin;
  } catch {
    return "https://raffle.koslabs.app";
  }
}

export function escapeTelegramHtml(value: string): string {
  return value.replace(/[&<>]/gu, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

export function telegramUserMention(userId: number, label: string): string {
  return `<a href="tg://user?id=${userId}">${escapeTelegramHtml(label)}</a>`;
}

/**
 * Humanised countdown for a raffle card. Telegram has no native relative
 * timestamp the way Discord does, so a raw ISO string was the only thing
 * members saw; "in 3h 20m" is the closest equivalent we can render.
 */
export function telegramCountdown(target: Date, now = new Date()): string {
  const ms = target.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const past = ms <= 0;
  const total = Math.floor(Math.abs(ms) / 1000);

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  let spoken: string;
  if (days > 0) spoken = `${days}d ${hours}h`;
  else if (hours > 0) spoken = `${hours}h ${minutes}m`;
  else if (minutes > 0) spoken = `${minutes}m`;
  else spoken = "under a minute";

  return past ? `${spoken} ago` : `in ${spoken}`;
}

export function displayTelegramError(reasons: string[]): string {
  return (reasons[0] ?? "Requirements are not complete.").slice(0, 180);
}

export type TelegramStartPayload =
  | { kind: "home" }
  | { kind: "link"; secret: string }
  | { kind: "onboarding" }
  | { kind: "welcome"; communityId: string }
  | { kind: "raffle"; raffleId: number }
  | { kind: "invite"; code: string }
  | { kind: "discord-code" }
  | { kind: "invalid" };

export function parseTelegramStartPayload(value: string): TelegramStartPayload {
  const payload = value.trim();
  if (!payload) return { kind: "home" };
  if (payload === "onboarding") return { kind: "onboarding" };
  if (payload === "dcode") return { kind: "discord-code" };

  const link = payload.match(/^link_([A-Za-z0-9_-]{24,64})$/u);
  if (link) return { kind: "link", secret: link[1] };

  const welcome = payload.match(/^welcome_([a-z0-9]{20,36})$/u);
  if (welcome) return { kind: "welcome", communityId: welcome[1] };

  const raffle = payload.match(/^raffle_(\d{1,10})$/u);
  if (raffle) {
    const raffleId = Number(raffle[1]);
    if (Number.isSafeInteger(raffleId) && raffleId > 0) {
      return { kind: "raffle", raffleId };
    }
  }

  const invite = payload.match(/^invite_([A-Za-z0-9_-]{4,32})$/u);
  if (invite) return { kind: "invite", code: invite[1] };

  return { kind: "invalid" };
}
