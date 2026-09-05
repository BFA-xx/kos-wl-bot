import assert from "node:assert/strict";
import test from "node:test";
import { buildId } from "../utils/ids.js";
import {
  buildCountModal,
  clampCount,
  decodeState,
  encodeState,
  isTeamWalletFillAction,
  parseTypedCount,
} from "./teamWalletFill.js";

test("panel state survives a custom-id round trip", () => {
  for (const mode of ["ROUND_ROBIN", "RANDOM", "PRIORITY"] as const) {
    const state = { raffleId: 186, count: 5, mode };
    assert.deepEqual(decodeState(encodeState(state)), state);
  }
});

test("the encoded id stays well inside Discord's 100-char cap", () => {
  // buildId throws past 100; the worst case is the longest action plus a
  // full-width raffle id and count.
  const id = buildId(
    "twf_confirm",
    ...encodeState({ raffleId: 2147483647, count: 9999, mode: "ROUND_ROBIN" }),
  );
  assert.ok(id.length < 60, `id was ${id.length} chars: ${id}`);
});

test("rejects a malformed or stale panel id", () => {
  assert.equal(decodeState([]), null);
  assert.equal(decodeState(["186", "5", "Z"]), null, "unknown mode code");
  assert.equal(decodeState(["abc", "5", "R"]), null, "non-numeric raffle");
  assert.equal(decodeState(["186", "-1", "R"]), null, "negative count");
  assert.equal(decodeState(["0", "5", "R"]), null, "raffle id 0");
});

test("clamps the count to what the pool can supply", () => {
  assert.equal(clampCount(4, 10), 4);
  assert.equal(clampCount(20, 10), 10, "cannot exceed availability");
  assert.equal(clampCount(0, 10), 1, "never drops below one while stock lasts");
  assert.equal(clampCount(-5, 10), 1);
  assert.equal(clampCount(3, 0), 0, "an empty pool pins the count at zero");
});

test("claims only its own component actions", () => {
  assert.ok(isTeamWalletFillAction("twf_inc"));
  assert.ok(isTeamWalletFillAction("twf_mode"));
  assert.ok(isTeamWalletFillAction("twf_x"));
  assert.ok(!isTeamWalletFillAction("enter"));
  assert.ok(!isTeamWalletFillAction("v_start"));
  assert.ok(!isTeamWalletFillAction("rf_pub"));
});

test("accepts a typed count and rejects anything that is not one", () => {
  assert.equal(parseTypedCount("61"), 61);
  assert.equal(parseTypedCount("  7 "), 7, "surrounding space is fine");
  assert.equal(
    parseTypedCount("1,200"),
    1200,
    "thousands separators tolerated",
  );
  assert.equal(
    parseTypedCount("0"),
    0,
    "zero parses; clamping decides its fate",
  );

  assert.equal(parseTypedCount(""), null);
  assert.equal(parseTypedCount("abc"), null);
  assert.equal(parseTypedCount("5.5"), null, "not a whole number");
  assert.equal(parseTypedCount("-3"), null, "negatives are not digits");
  assert.equal(parseTypedCount("1e3"), null, "no exponent notation");
  assert.equal(
    parseTypedCount("999999"),
    null,
    "beyond the field's max length",
  );
});

test("a typed number over availability is clamped, not rejected", () => {
  // Typing 500 into a pool of 62 should fill 62 rather than erroring.
  assert.equal(clampCount(parseTypedCount("500")!, 62), 62);
});

test("the count modal round-trips its panel state", () => {
  const state = { raffleId: 186, count: 61, mode: "RANDOM" as const };
  const modal = buildCountModal(state).toJSON();
  const args = modal.custom_id.split(":").slice(2);
  assert.deepEqual(decodeState(args), state);
  assert.ok(modal.custom_id.length <= 100);
  assert.equal(modal.title.length <= 45, true);
});
