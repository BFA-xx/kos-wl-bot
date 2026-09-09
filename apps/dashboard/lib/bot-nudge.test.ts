import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nudgeBot } from "./bot-nudge";

const CHANNEL = "123456789012345678";
const ORIGINAL = { ...process.env };

function lastCall() {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const [url, init] = fetchMock.mock.calls[0];
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("nudgeBot", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}"));
    process.env.DISCORD_CONTROL_CHANNEL_ID = CHANNEL;
    process.env.DISCORD_BOT_TOKEN = "token-abc";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.restoreAllMocks();
  });

  it("posts a marker to the control channel as the bot", async () => {
    await nudgeBot("raffle #202 created");
    const { url, init, body } = lastCall();
    expect(url).toBe(
      `https://discord.com/api/v10/channels/${CHANNEL}/messages`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bot token-abc",
    );
    expect(body.content).toBe("raffle #202 created");
  });

  it("never lets a marker ping anyone", async () => {
    await nudgeBot("@everyone raffle #202 created");
    expect(lastCall().body.allowed_mentions).toEqual({ parse: [] });
  });

  it("truncates a long reason to stay inside Discord's limit", async () => {
    await nudgeBot("x".repeat(500));
    expect(lastCall().body.content).toHaveLength(180);
  });

  it("stays silent when no control channel is configured", async () => {
    delete process.env.DISCORD_CONTROL_CHANNEL_ID;
    await nudgeBot("raffle #202 created");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("stays silent when no bot token is configured", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    await nudgeBot("raffle #202 created");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the local DISCORD_TOKEN name used in development", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_TOKEN = "dev-token";
    await nudgeBot("raffle #202 created");
    expect(
      (lastCall().init.headers as Record<string, string>).authorization,
    ).toBe("Bot dev-token");
  });

  // The whole point of the nudge is that it is optional. If it could throw, a
  // Discord outage would start failing raffle creation — strictly worse than
  // the sweep latency it exists to remove.
  it("never throws when Discord is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(nudgeBot("raffle #202 created")).resolves.toBeUndefined();
  });

  it("never throws when Discord rate-limits the marker", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(nudgeBot("raffle #202 created")).resolves.toBeUndefined();
  });
});
