import assert from "node:assert/strict";
import test from "node:test";
import { RaidStatus } from "@kos/db";
import { buildRaidEmbed } from "./raidService.js";

test("raid embed includes task, timing, reward, and submission guidance", () => {
  const json = buildRaidEmbed({
    title: "Launch push",
    tweetUrls: ["https://x.com/kos/status/100"],
    instructions: "Leave a thoughtful comment.",
    endAt: new Date("2026-07-28T12:00:00.000Z"),
    status: RaidStatus.LIVE,
    rewardRoleId: "123456789012345678",
    rewardRoleName: "Raid Participant",
    participantLimit: 50,
    allowMultipleSubmissions: false,
    validParticipantCount: 7,
  }).toJSON();

  assert.equal(json.title, "⚡ Launch push");
  assert.equal(json.description, "Leave a thoughtful comment.");
  assert.deepEqual(
    json.fields?.map((field) => field.name),
    ["Raid post", "Ends", "Reward role", "Participants", "Submit participation"],
  );
  assert.match(json.fields?.[0]?.value ?? "", /https:\/\/x\.com\/kos\/status\/100/u);
  assert.equal(json.fields?.[2]?.value, "<@&123456789012345678>");
  assert.equal(json.fields?.[3]?.value, "7 / 50");
});
