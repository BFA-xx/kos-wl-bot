import { PingMentionMode } from "@prisma/client";

export interface PingInput {
  guildId: string;
  title: string;
  message: string;
  channelId: string;
  mentionMode: PingMentionMode;
  roleIds: string[];
  linkUrl: string | null;
  scheduledAt: Date | null;
}

export function parsePingInput(
  body: Record<string, unknown>,
): PingInput | { error: string } {
  const guildId = cleanId(body.guildId);
  const channelId = cleanId(body.channelId);
  const title = String(body.title ?? "").trim();
  const message = String(body.message ?? "").trim();
  const mentionMode = String(body.mentionMode ?? "NONE") as PingMentionMode;
  const roleIds = [
    ...new Set(
      (Array.isArray(body.roleIds) ? body.roleIds : [])
        .map(cleanId)
        .filter(Boolean),
    ),
  ];
  const linkUrl = parseOptionalUrl(body.linkUrl);
  const scheduledAt = parseOptionalDate(body.scheduledAt);

  if (!guildId) return { error: "Select a connected Discord server." };
  if (!channelId) return { error: "Select a Discord channel." };
  if (!title || title.length > 120)
    return {
      error: "Ping title is required and must be under 120 characters.",
    };
  if (!message || message.length > 4_000)
    return {
      error: "Ping message is required and must be under 4,000 characters.",
    };
  if (!Object.values(PingMentionMode).includes(mentionMode))
    return { error: "Select a valid mention type." };
  if (mentionMode === PingMentionMode.ROLES && roleIds.length === 0)
    return { error: "Select at least one role to mention." };
  if (roleIds.length > 10)
    return { error: "A ping can mention at most ten roles." };
  if (linkUrl === undefined) return { error: "Link URL is invalid." };
  if (scheduledAt === undefined) return { error: "Schedule time is invalid." };

  return {
    guildId,
    title,
    message,
    channelId,
    mentionMode,
    roleIds: mentionMode === PingMentionMode.ROLES ? roleIds : [],
    linkUrl,
    scheduledAt,
  };
}

function cleanId(value: unknown): string {
  const id = String(value ?? "").trim();
  return /^\d{5,25}$/u.test(id) ? id : "";
}

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOptionalUrl(value: unknown): string | null | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
