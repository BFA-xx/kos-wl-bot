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
  | { kind: "invalid" };

export function parseTelegramStartPayload(value: string): TelegramStartPayload {
  const payload = value.trim();
  if (!payload) return { kind: "home" };
  if (payload === "onboarding") return { kind: "onboarding" };

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
