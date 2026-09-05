import assert from "node:assert/strict";
import test from "node:test";
import { buildId } from "../utils/ids.js";
import {
  clampCount,
  decodeState,
  encodeState,
  isTeamWalletFillAction,
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
