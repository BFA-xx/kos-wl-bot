import assert from "node:assert/strict";
import test from "node:test";
import { RaffleStatus } from "@kos/db";
import { startMentionContent } from "./startMention.js";

const live = {
  status: RaffleStatus.LIVE,
  startPing: "everyone",
  projectName: "NUTSY",
  title: "GTD WL",
};

test("the ping names the raffle so the notification is not just @everyone", () => {
  assert.equal(
    startMentionContent(live),
    "🎟️ **NUTSY — GTD WL** raffle is live! @everyone",
  );
});

test("a title that already names the project is not repeated", () => {
  assert.equal(
    startMentionContent({ ...live, startPing: "here", title: "KOS X NUTSY GTD" }),
    "🎟️ **KOS X NUTSY GTD** raffle is live! @here",
  );
});

test("no ping when pings are off or the raffle is not live", () => {
  assert.equal(startMentionContent({ ...live, startPing: "none" }), "");
  assert.equal(
    startMentionContent({ ...live, status: RaffleStatus.UPCOMING }),
    "",
  );
});
