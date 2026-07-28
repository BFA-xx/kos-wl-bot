import assert from "node:assert/strict";
import test from "node:test";
import { PingMentionMode } from "@kos/db";
import { pingMentionPayload } from "./pingService.js";

test("role pings mention only explicitly selected roles", () => {
  assert.deepEqual(pingMentionPayload(PingMentionMode.ROLES, ["123", "456"]), {
    content: "<@&123> <@&456>",
    allowedMentions: { parse: [], roles: ["123", "456"] },
  });
});

test("@everyone and @here require the explicit everyone parse flag", () => {
  assert.deepEqual(pingMentionPayload(PingMentionMode.EVERYONE, []), {
    content: "@everyone",
    allowedMentions: { parse: ["everyone"] },
  });
  assert.deepEqual(pingMentionPayload(PingMentionMode.HERE, []), {
    content: "@here",
    allowedMentions: { parse: ["everyone"] },
  });
});

test("no-mention pings cannot parse user supplied mentions", () => {
  assert.deepEqual(pingMentionPayload(PingMentionMode.NONE, []), {
    allowedMentions: { parse: [] },
  });
});
