import { describe, expect, it } from "vitest";
import { parseRaidInput } from "./raid-input";

const valid = {
  guildId: "123456789012345678",
  title: "Launch raid",
  tweetUrl: "https://twitter.com/kos/status/100?s=20",
  instructions: "Comment on the post",
  proofType: "AUTO",
  startAt: "2026-07-28T10:00:00.000Z",
  endAt: "2026-07-28T11:00:00.000Z",
  channelId: "123456789012345679",
  rewardRoleName: "Raid Winner",
};

describe("parseRaidInput", () => {
  it("normalizes valid X URLs", () => {
    const parsed = parseRaidInput(valid);
    expect(parsed).not.toHaveProperty("error");
    if ("error" in parsed) return;
    expect(parsed.tweetUrls).toEqual(["https://x.com/kos/status/100"]);
    expect(parsed.startPing).toBe("everyone");
  });

  it("accepts the same start ping choices as raffle hosting", () => {
    for (const startPing of ["everyone", "here", "none"]) {
      const parsed = parseRaidInput({ ...valid, startPing });
      expect(parsed).not.toHaveProperty("error");
      if ("error" in parsed) continue;
      expect(parsed.startPing).toBe(startPing);
    }
  });

  it("rejects unsupported start ping values", () => {
    expect(parseRaidInput({ ...valid, startPing: "role" })).toEqual({
      error: "Select a valid start ping.",
    });
  });

  it("rejects an invalid time range", () => {
    expect(
      parseRaidInput({ ...valid, endAt: "2026-07-28T09:00:00.000Z" }),
    ).toEqual({ error: "Raid end must be after its start." });
  });

  it("rejects broad mentions as reward roles", () => {
    expect(parseRaidInput({ ...valid, rewardRoleName: "@everyone" })).toEqual({
      error: "Choose a dedicated reward role, not @everyone or @here.",
    });
  });
});
