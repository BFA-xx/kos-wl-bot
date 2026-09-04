import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocks = vi.hoisted(() => ({
  communityFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    telegramCommunity: { findUnique: mocks.communityFindUnique },
    telegramCommunityMember: { findFirst: mocks.memberFindFirst },
  },
}));
vi.mock("@/lib/telegram/rate-limit", () => ({
  consumeTelegramRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/telegram", () => ({
  telegramConfig: () => ({ botUsername: "KOSRafflesBot" }),
}));

import {
  asksForKosDiscord,
  handleKosDiscordRequest,
  normalizeDiscordInvite,
  sendDiscordCodePrivately,
} from "@/lib/telegram/discord-link";

const SECRET = "TEST-ONLY-CODE";

function groupCtx(text: string) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    from: { id: 42, is_bot: false },
    chat: { id: -100, type: "supergroup" },
    message: { text, message_id: 7 },
    reply,
  } as unknown as Context;
  return { ctx, reply };
}

describe("KOS Discord trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(true);
    mocks.communityFindUnique.mockResolvedValue({
      status: "ACTIVE",
      featureFlags: ["DISCORD_LINK"],
      discordInviteUrl: "https://discord.gg/example",
      discordAccessCode: SECRET,
    });
  });

  it("matches the phrase however it is written", () => {
    expect(asksForKosDiscord("KOS Discord")).toBe(true);
    expect(asksForKosDiscord("where is the kos discord?")).toBe(true);
    expect(asksForKosDiscord("KOS_Discord")).toBe(true);
  });

  it("ignores commands and unrelated chatter", () => {
    expect(asksForKosDiscord("/setdiscord https://x")).toBe(false);
    expect(asksForKosDiscord("discord is fine")).toBe(false);
    expect(asksForKosDiscord("koser discordant")).toBe(false);
  });

  it("never puts the code in the group reply", async () => {
    const { ctx, reply } = groupCtx("KOS Discord");
    await handleKosDiscordRequest(ctx, vi.fn());
    expect(reply).toHaveBeenCalledOnce();
    const [text, options] = reply.mock.calls[0]!;
    expect(text).not.toContain(SECRET);
    expect(JSON.stringify(options)).not.toContain(SECRET);
  });

  it("passes unrelated messages down the chain", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = groupCtx("good morning");
    await handleKosDiscordRequest(ctx, next);
    expect(next).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });

  it("stays silent when the community has not enabled it", async () => {
    mocks.communityFindUnique.mockResolvedValue({
      status: "ACTIVE",
      featureFlags: [],
      discordInviteUrl: "https://discord.gg/example",
      discordAccessCode: SECRET,
    });
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = groupCtx("KOS Discord");
    await handleKosDiscordRequest(ctx, next);
    expect(reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not answer a flood", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = groupCtx("KOS Discord");
    await handleKosDiscordRequest(ctx, next);
    expect(reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("private code delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses outside a private chat", async () => {
    const { ctx, reply } = groupCtx("/discordcode");
    await sendDiscordCodePrivately(ctx);
    expect(reply.mock.calls[0]?.[0]).not.toContain(SECRET);
  });

  it("gives the code to a member of the community", async () => {
    mocks.memberFindFirst.mockResolvedValue({
      community: {
        discordAccessCode: SECRET,
        discordInviteUrl: "https://discord.gg/example",
      },
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      from: { id: 42 },
      chat: { id: 42, type: "private" },
      reply,
    } as unknown as Context;
    await sendDiscordCodePrivately(ctx);
    expect(reply.mock.calls[0]?.[0]).toContain(SECRET);
  });

  it("withholds it from someone the group does not know", async () => {
    mocks.memberFindFirst.mockResolvedValue(null);
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      from: { id: 99 },
      chat: { id: 99, type: "private" },
      reply,
    } as unknown as Context;
    await sendDiscordCodePrivately(ctx);
    expect(reply.mock.calls[0]?.[0]).not.toContain(SECRET);
  });
});

describe("invite validation", () => {
  it("takes only https", () => {
    expect(normalizeDiscordInvite("https://discord.gg/abc")).toBe(
      "https://discord.gg/abc",
    );
    expect(normalizeDiscordInvite("http://discord.gg/abc")).toBeNull();
    expect(normalizeDiscordInvite("javascript:alert(1)")).toBeNull();
    expect(normalizeDiscordInvite("not a url")).toBeNull();
  });
});
