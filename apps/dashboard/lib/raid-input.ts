import { RaidProofType, parseXStatusUrl } from "@kos/db";

export interface RaidInput {
  guildId: string;
  title: string;
  tweetUrls: string[];
  instructions: string;
  proofType: RaidProofType;
  startPing: "everyone" | "here" | "none";
  startAt: Date;
  endAt: Date;
  channelId: string;
  staffChannelId: string | null;
  rewardRoleId: string | null;
  rewardRoleName: string;
  participantLimit: number | null;
  allowMultipleSubmissions: boolean;
  announcementMessage: string | null;
}

export function parseRaidInput(
  body: Record<string, unknown>,
): RaidInput | { error: string } {
  const guildId = cleanId(body.guildId);
  const title = String(body.title ?? "").trim();
  const instructions = String(body.instructions ?? "").trim();
  const proofType = String(body.proofType ?? "AUTO") as RaidProofType;
  const startPing = parseStartPing(body.startPing);
  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  const channelId = cleanId(body.channelId);
  const staffChannelId = cleanOptionalId(body.staffChannelId);
  const rewardRoleId = cleanOptionalId(body.rewardRoleId);
  const rewardRoleName = String(body.rewardRoleName ?? "").trim();
  const announcementMessage = cleanOptionalText(body.announcementMessage);
  const participantLimit = parseOptionalPositiveInt(body.participantLimit);
  const allowMultipleSubmissions = body.allowMultipleSubmissions === true;
  const tweetInput = Array.isArray(body.tweetUrls)
    ? body.tweetUrls
    : [body.tweetUrl];
  const tweetUrls = [
    ...new Map(
      tweetInput
        .filter((value): value is string => typeof value === "string")
        .map(parseXStatusUrl)
        .filter((value) => value !== null)
        .map((value) => [value.statusId, value.url]),
    ).values(),
  ];

  if (!guildId) return { error: "Select a connected Discord server." };
  if (!title || title.length > 120)
    return {
      error: "Raid title is required and must be under 120 characters.",
    };
  if (!instructions || instructions.length > 1_500)
    return {
      error: "Instructions are required and must be under 1,500 characters.",
    };
  if (tweetUrls.length === 0)
    return { error: "Add a valid public X post URL." };
  if (tweetUrls.length > 5)
    return { error: "A raid can contain at most five X post URLs." };
  if (!Object.values(RaidProofType).includes(proofType))
    return { error: "Select a valid proof type." };
  if (!startPing) return { error: "Select a valid start ping." };
  if (!startAt || !endAt) return { error: "Start and end times are required." };
  if (endAt <= startAt) return { error: "Raid end must be after its start." };
  if (!channelId) return { error: "Select a Discord raid channel." };
  if (!rewardRoleName || rewardRoleName.length > 100)
    return { error: "Reward role name is required." };
  if (["@everyone", "@here"].includes(rewardRoleName.toLowerCase()))
    return { error: "Choose a dedicated reward role, not @everyone or @here." };
  if (participantLimit === undefined)
    return { error: "Participant limit must be a positive whole number." };
  if (announcementMessage && announcementMessage.length > 1_000)
    return { error: "Announcement message is too long." };

  return {
    guildId,
    title,
    tweetUrls,
    instructions,
    proofType,
    startPing,
    startAt,
    endAt,
    channelId,
    staffChannelId,
    rewardRoleId,
    rewardRoleName,
    participantLimit,
    allowMultipleSubmissions,
    announcementMessage,
  };
}

function parseStartPing(
  value: unknown,
): "everyone" | "here" | "none" | null {
  const ping = String(value ?? "everyone");
  return ping === "everyone" || ping === "here" || ping === "none"
    ? ping
    : null;
}

function cleanId(value: unknown): string {
  const id = String(value ?? "").trim();
  return /^\d{5,25}$/u.test(id) ? id : "";
}

function cleanOptionalId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return cleanId(raw) || null;
}

function cleanOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseDate(value: unknown): Date | null {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalPositiveInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 1_000_000
    ? number
    : undefined;
}
