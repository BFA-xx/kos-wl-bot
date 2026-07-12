import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUserGuildsResult } from "./discord-oauth";

describe("Discord guild membership lookup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a rate-limited request and returns the guild list", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 0.01 }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "guild-1",
              name: "KOS",
              icon: null,
              owner: false,
              permissions: "0",
            },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchUserGuildsResult("token");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({
      ok: true,
      guilds: [
        {
          id: "guild-1",
          name: "KOS",
          icon: null,
          owner: false,
          permissions: "0",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent authorization failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUserGuildsResult("token")).resolves.toEqual({
      ok: false,
      guilds: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
