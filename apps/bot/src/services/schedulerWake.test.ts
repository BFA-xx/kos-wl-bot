import assert from "node:assert/strict";
import test from "node:test";
import {
  registerSchedulerWake,
  requestSchedulerWake,
} from "./schedulerWake.js";

test("forwards wake requests to the active scheduler", () => {
  const reasons: string[] = [];
  const unregister = registerSchedulerWake((reason) => reasons.push(reason));

  requestSchedulerWake("raffle published");
  assert.deepEqual(reasons, ["raffle published"]);

  unregister();
  requestSchedulerWake("after shutdown");
  assert.deepEqual(reasons, ["raffle published"]);
});

test("an old unregister callback cannot remove a replacement scheduler", () => {
  const reasons: string[] = [];
  const unregisterOld = registerSchedulerWake(() => reasons.push("old"));
  const unregisterCurrent = registerSchedulerWake(() =>
    reasons.push("current"),
  );

  unregisterOld();
  requestSchedulerWake("raffle published");
  assert.deepEqual(reasons, ["current"]);

  unregisterCurrent();
});
