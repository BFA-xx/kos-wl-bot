import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUserGuildsResult } from "./discord-oauth";

describe("Discord guild membership lookup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a rate-limited request and returns the guild list", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "997" },
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
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 997);
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
