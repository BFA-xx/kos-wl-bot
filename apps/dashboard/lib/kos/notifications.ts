/**
 * KOS member notification vocabulary.
 *
 * Provider-neutral on purpose: Telegram renders these as inline toggles and
 * the website renders them as checkboxes, but both read and write the one
 * `KosNotificationPreference` row. Adding a key here surfaces it on both.
 */

export const KOS_NOTIFICATION_KEYS = [
  "announcements",
  "raffleReminders",
  "winners",
  "points",
  "community",
] as const;

export type KosNotificationKey = (typeof KOS_NOTIFICATION_KEYS)[number];

export const KOS_NOTIFICATION_LABELS: Record<KosNotificationKey, string> = {
  announcements: "Announcements",
  raffleReminders: "Raffle reminders",
  winners: "Winner updates",
  points: "Points updates",
  community: "Community updates",
};

export type KosNotificationPreferences = Record<KosNotificationKey, boolean>;

/**
 * Narrow untrusted JSON to the known keys. Callers must never spread a request
 * body into Prisma — only the keys this returns are writable.
 */
export function parseKosNotificationPatch(
  input: unknown,
): Partial<KosNotificationPreferences> {
  if (!input || typeof input !== "object") return {};
  const body = input as Record<string, unknown>;
  const patch: Partial<KosNotificationPreferences> = {};
  for (const key of KOS_NOTIFICATION_KEYS) {
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
  }
  return patch;
}
