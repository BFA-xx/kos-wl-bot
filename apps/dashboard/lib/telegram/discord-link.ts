import {
  type Bot,
  type Context,
  InlineKeyboard,
  type NextFunction,
} from "grammy";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePrivateTelegramCommunityPermission } from "@/lib/telegram/access";
import { escapeTelegramHtml } from "@/lib/telegram/format";
import { consumeTelegramRateLimit } from "@/lib/telegram/rate-limit";
import { telegramConfig } from "@/lib/telegram";

/**
 * "KOS Discord" in the group answers with the invite.
 *
 * The entry code is deliberately NOT part of that answer. A public trigger
 * handing out a code would put it in the scrollback of everyone present and
 * make the lock decorative, so the code only ever moves through a private
 * chat the member opens themselves.
 *
 * Neither value is committed: this repository is public, so both are set at
 * runtime by an admin and stored per community.
 */

const REQUEST_LIMIT = 2;

const DISCORD_PATTERN =
  /(?:^|[^\p{L}\p{N}_])kos[\s_-]*discord(?=$|[^\p{L}\p{N}_])/iu;

export function asksForKosDiscord(text: string): boolean {
  return !text.trimStart().startsWith("/") && DISCORD_PATTERN.test(text);
}

/** Accept only an https URL, so the bot cannot be made to publish junk. */
export function normalizeDiscordInvite(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function handleKosDiscordRequest(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const text = ctx.message?.text;
  if (
    !ctx.from ||
    ctx.from.is_bot ||
    !ctx.chat ||
    !["group", "supergroup"].includes(ctx.chat.type) ||
    !text ||
    !asksForKosDiscord(text)
  ) {
    await next();
    return;
  }

  const community = await prisma.telegramCommunity.findUnique({
    where: { telegramChatId: String(ctx.chat.id) },
    select: {
      status: true,
      featureFlags: true,
      discordInviteUrl: true,
      discordAccessCode: true,
    },
  });
  if (
    !community ||
    community.status !== "ACTIVE" ||
    !community.featureFlags.includes("DISCORD_LINK") ||
    !community.discordInviteUrl
  ) {
    await next();
    return;
  }

  if (
    !(await consumeTelegramRateLimit(
      String(ctx.from.id),
      "discord_link",
      new Date(),
      REQUEST_LIMIT,
    ))
  ) {
    await next();
    return;
  }

  const keyboard = new InlineKeyboard().url(
    "Open Discord",
    community.discordInviteUrl,
  );
  const username = telegramConfig().botUsername;
  if (community.discordAccessCode && username) {
    // A deep link rather than the code itself: the member has to open the bot,
    // which is the private channel the code is allowed to travel through.
    keyboard.url("Get the entry code", `https://t.me/${username}?start=dcode`);
  }

  await ctx.reply(
    community.discordAccessCode
      ? "Here is the KOS Discord. It asks for an entry code — tap below and KOS Bot will send it to you privately."
      : "Here is the KOS Discord.",
    {
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
      reply_parameters: ctx.message?.message_id
        ? { message_id: ctx.message.message_id }
        : undefined,
    },
  );
}

/**
 * Send the code privately. Restricted to people the group already knows, so
 * finding the bot is not on its own enough to collect the code.
 */
export async function sendDiscordCodePrivately(ctx: Context): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    await ctx.reply("Ask KOS Bot for the entry code in a private chat.");
    return;
  }
  const membership = await prisma.telegramCommunityMember.findFirst({
    where: {
      telegramUserId: String(ctx.from.id),
      status: "ACTIVE",
      community: {
        status: "ACTIVE",
        featureFlags: { has: "DISCORD_LINK" },
        discordAccessCode: { not: null },
      },
    },
    select: {
      community: {
        select: { discordAccessCode: true, discordInviteUrl: true },
      },
    },
  });
  if (!membership?.community.discordAccessCode) {
    await ctx.reply(
      "No KOS Discord code is available for you yet. Join the KOS Telegram community first.",
    );
    return;
  }
  const keyboard = membership.community.discordInviteUrl
    ? new InlineKeyboard().url(
        "Open Discord",
        membership.community.discordInviteUrl,
      )
    : undefined;
  await ctx.reply(
    [
      "KOS Discord entry code:",
      `<code>${escapeTelegramHtml(membership.community.discordAccessCode)}</code>`,
      "",
      "Keep it to yourself — it is what keeps the server closed.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    },
  );
}

async function communityForAdmin(ctx: Context, rest: string) {
  // A chat id may lead the argument so an admin of several communities can say
  // which one without leaving the private chat.
  const match = rest.trim().match(/^(-?\d{6,20})\s+([\s\S]+)$/u);
  const explicitChatId = match?.[1];
  const value = (match?.[2] ?? rest).trim();

  const communities = await prisma.telegramCommunity.findMany({
    where: {
      status: "ACTIVE",
      ...(explicitChatId ? { telegramChatId: explicitChatId } : {}),
    },
    select: { id: true, communityName: true, telegramChatId: true },
  });
  const allowed: typeof communities = [];
  for (const community of communities) {
    const access = await requirePrivateTelegramCommunityPermission(
      ctx,
      community.id,
      PERMISSIONS.SETTINGS_EDIT,
    );
    if (access) allowed.push(community);
  }
  return { allowed, value };
}

async function setDiscordInvite(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Set the Discord link in a private chat with KOS Bot.");
    return;
  }
  const { allowed, value } = await communityForAdmin(
    ctx,
    String(ctx.match ?? ""),
  );
  if (allowed.length !== 1) {
    await ctx.reply(
      allowed.length === 0
        ? "You cannot edit settings for a KOS community."
        : "You manage several communities. Use /setdiscord <chat-id> <url>.",
    );
    return;
  }
  const community = allowed[0]!;
  if (!value || value === "show") {
    const current = await prisma.telegramCommunity.findUnique({
      where: { id: community.id },
      select: { discordInviteUrl: true, discordAccessCode: true },
    });
    await ctx.reply(
      [
        `${community.communityName}`,
        `Invite: ${current?.discordInviteUrl ?? "not set"}`,
        `Entry code: ${current?.discordAccessCode ? "set" : "not set"}`,
        "",
        "Usage: /setdiscord <https url>, or /setdiscord clear",
      ].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
    return;
  }
  if (value === "clear") {
    await prisma.telegramCommunity.update({
      where: { id: community.id },
      data: { discordInviteUrl: null },
    });
    await ctx.reply("Discord invite cleared. The bot will stop answering.");
    return;
  }
  const url = normalizeDiscordInvite(value);
  if (!url) {
    await ctx.reply(
      "Send an https link, for example /setdiscord https://discord.gg/xxxx",
    );
    return;
  }
  await prisma.telegramCommunity.update({
    where: { id: community.id },
    data: { discordInviteUrl: url },
  });
  await ctx.reply(
    `Saved. "KOS Discord" in ${community.communityName} now answers with that link.`,
    { link_preview_options: { is_disabled: true } },
  );
}

async function setDiscordCode(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== "private") {
    // Refuse rather than act: the command text carries the code, and in a
    // group it would sit in the scrollback for everyone.
    await ctx.reply(
      "Set the entry code in a private chat with KOS Bot, never in the group.",
    );
    return;
  }
  const { allowed, value } = await communityForAdmin(
    ctx,
    String(ctx.match ?? ""),
  );
  if (allowed.length !== 1) {
    await ctx.reply(
      allowed.length === 0
        ? "You cannot edit settings for a KOS community."
        : "You manage several communities. Use /setdiscordcode <chat-id> <code>.",
    );
    return;
  }
  const community = allowed[0]!;
  if (!value) {
    await ctx.reply("Usage: /setdiscordcode <code>, or /setdiscordcode clear");
    return;
  }
  if (value === "clear") {
    await prisma.telegramCommunity.update({
      where: { id: community.id },
      data: { discordAccessCode: null },
    });
    await ctx.reply("Entry code cleared.");
    return;
  }
  await prisma.telegramCommunity.update({
    where: { id: community.id },
    data: { discordAccessCode: value.slice(0, 120) },
  });
  await ctx.reply(
    `Entry code saved for ${community.communityName}. Members get it privately with /discordcode.`,
  );
}

export function registerTelegramDiscordLinkHandlers(bot: Bot): void {
  bot.command("setdiscord", setDiscordInvite);
  bot.command("setdiscordcode", setDiscordCode);
  bot.command("discordcode", sendDiscordCodePrivately);
  bot.on("message:text", handleKosDiscordRequest);
}
