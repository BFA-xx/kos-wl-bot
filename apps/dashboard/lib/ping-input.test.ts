import { describe, expect, it } from "vitest";
import { parsePingInput } from "./ping-input";

const valid = {
  guildId: "123456789012345678",
  channelId: "123456789012345679",
  title: "Raid starts now",
  message: "Join the raid thread.",
  mentionMode: "ROLES",
  roleIds: ["123456789012345680"],
};

describe("parsePingInput", () => {
  it("accepts a role-targeted ping", () => {
    const parsed = parsePingInput(valid);
    expect(parsed).not.toHaveProperty("error");
    if ("error" in parsed) return;
    expect(parsed.roleIds).toEqual(["123456789012345680"]);
  });

  it("requires roles for role mode", () => {
    expect(parsePingInput({ ...valid, roleIds: [] })).toEqual({
      error: "Select at least one role to mention.",
    });
  });
});
