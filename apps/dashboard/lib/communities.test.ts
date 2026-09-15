import { describe, expect, it } from "vitest";
import {
  communityHasGuildMembership,
  memberCommunityGuildIds,
  memberRaffleWhere,
} from "./communities";

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

describe("member community guilds", () => {
  const communities = [
    { guildConnections: [{ guildId: "kos-main" }, { guildId: "kos-alpha" }] },
    { guildConnections: [{ guildId: "prx" }] },
    { guildConnections: [] },
  ];

  it("keeps every guild of a community the member is in, and nothing else", () => {
    expect(
      memberCommunityGuildIds(communities, new Set(["kos-alpha", "elsewhere"])),
    ).toEqual(new Set(["kos-main", "kos-alpha"]));
  });

  it("is empty when the member is in none of the communities", () => {
    expect(
      memberCommunityGuildIds(communities, new Set(["elsewhere"])),
    ).toEqual(new Set());
  });
});

describe("member raffle filter", () => {
  it("keeps raffles from the member's communities and any they entered", () => {
    expect(memberRaffleWhere("user-1", new Set(["kos-main"]))).toEqual({
      OR: [
        { guildId: { in: ["kos-main"] } },
        { participants: { some: { userId: "user-1" } } },
      ],
    });
  });

  it("falls back to entered raffles alone when membership is unknown", () => {
    expect(memberRaffleWhere("user-1", new Set())).toEqual({
      OR: [
        { guildId: { in: [] } },
        { participants: { some: { userId: "user-1" } } },
      ],
    });
  });
});
