import { describe, expect, it } from "vitest";
import { communityHasGuildMembership } from "./communities";

describe("community membership", () => {
  it("matches an organization when the member belongs to any connected guild", () => {
    expect(
      communityHasGuildMembership(
        [{ guildId: "guild-a" }, { guildId: "guild-b" }],
        new Set(["guild-b", "guild-c"]),
      ),
    ).toBe(true);
  });

  it("does not match unrelated Discord guilds", () => {
    expect(
      communityHasGuildMembership(
        [{ guildId: "guild-a" }],
        new Set(["guild-z"]),
      ),
    ).toBe(false);
  });
});
