import assert from "node:assert/strict";
import test from "node:test";
import { buildProofEmbed } from "./proofEmbed.js";
import { buildWinnerEmbed } from "./winnerEmbed.js";

const baseWinner = {
  id: 60,
  communityName: "KOS",
  projectName: "NUTSY",
  title: "GTD WL",
  spots: 3,
  endedAt: new Date("2026-07-11T20:15:00.000Z"),
  winners: [{ userId: "123456789", username: "winner" }],
  drawSeedHash: "abc123",
};

test("winner announcement uses community and project branding", () => {
  const json = buildWinnerEmbed({ ...baseWinner, entryCount: 19 }).toJSON();

  assert.equal(json.title, "🏆 KOS × NUTSY — WL Raffle Finished");
  assert.match(json.description ?? "", /\*\*Entries:\*\* 19/);
});

test("private completion embeds omit entry totals without a placeholder", () => {
  const winnerJson = buildWinnerEmbed(baseWinner).toJSON();
  const proofJson = buildProofEmbed({
    id: 60,
    projectName: "NUTSY",
    startAt: new Date("2026-07-11T19:15:00.000Z"),
    endAt: new Date("2026-07-11T20:15:00.000Z"),
    winnerCount: 1,
    messageLink: null,
    drawSeedHash: "abc123",
  }).toJSON();
  const serialized = JSON.stringify([winnerJson, proofJson]);

  assert.doesNotMatch(serialized, /Entries/i);
  assert.doesNotMatch(serialized, /Private/i);
});
