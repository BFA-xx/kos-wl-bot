import { describe, expect, it } from "vitest";
import { kosLeaderboardStart, resolveKosLevel } from "@/lib/telegram/points";

const levels = [
  { level: 1, name: "Member", minPoints: 0 },
  { level: 2, name: "Contributor", minPoints: 250 },
  { level: 3, name: "Builder", minPoints: 500 },
];

describe("KOS Telegram points", () => {
  it("resolves configurable current and next levels", () => {
    expect(resolveKosLevel(300, levels)).toEqual({
      level: levels[1],
      nextLevel: levels[2],
    });
    expect(resolveKosLevel(900, levels)).toEqual({
      level: levels[2],
      nextLevel: null,
    });
  });

  it("uses UTC calendar boundaries for leaderboard periods", () => {
    const now = new Date("2026-09-02T08:30:00.000Z");
    expect(kosLeaderboardStart("week", now)?.toISOString()).toBe(
      "2026-08-31T00:00:00.000Z",
    );
    expect(kosLeaderboardStart("month", now)?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(kosLeaderboardStart("all", now)).toBeUndefined();
  });
});
