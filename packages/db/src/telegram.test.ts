import assert from "node:assert/strict";
import test from "node:test";
import {
  hashIntegrationToken,
  isTelegramAdmin,
  isTelegramMember,
  telegramDisplayName,
} from "./telegram.js";

test("hashes opaque integration capabilities deterministically", () => {
  assert.equal(hashIntegrationToken("one-time-secret").length, 64);
  assert.equal(
    hashIntegrationToken("one-time-secret"),
    hashIntegrationToken("one-time-secret"),
  );
  assert.notEqual(
    hashIntegrationToken("one-time-secret"),
    hashIntegrationToken("different-secret"),
  );
});

test("uses stable Telegram membership semantics", () => {
  assert.equal(isTelegramMember({ status: "member" }), true);
  assert.equal(
    isTelegramMember({ status: "restricted", is_member: true }),
    true,
  );
  assert.equal(
    isTelegramMember({ status: "restricted", is_member: false }),
    false,
  );
  assert.equal(isTelegramMember({ status: "left" }), false);
  assert.equal(isTelegramAdmin({ status: "administrator" }), true);
  assert.equal(isTelegramAdmin({ status: "member" }), false);
});

test("builds display names without requiring a public username", () => {
  assert.equal(
    telegramDisplayName({ id: 1, first_name: "Ada", last_name: "Lovelace" }),
    "Ada Lovelace",
  );
  assert.equal(telegramDisplayName({ id: 1, first_name: "Ada" }), "Ada");
});
