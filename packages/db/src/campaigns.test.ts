import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeCampaignProgress,
  type CampaignProgressStep,
} from "./campaigns.js";

function step(
  id: string,
  required: boolean,
  done: boolean,
): CampaignProgressStep {
  return {
    kind: "TASK",
    id,
    taskId: id,
    title: id,
    required,
    done,
    position: 0,
  };
}

test("campaign completion requires every required step", () => {
  assert.deepEqual(
    summarizeCampaignProgress([
      step("required-done", true, true),
      step("required-open", true, false),
      step("optional-done", false, true),
    ]),
    {
      done: 2,
      total: 3,
      requiredDone: 1,
      requiredTotal: 2,
      complete: false,
    },
  );
});

test("optional steps do not block completion", () => {
  assert.equal(
    summarizeCampaignProgress([
      step("required", true, true),
      step("optional", false, false),
    ]).complete,
    true,
  );
});

test("a campaign with no required steps cannot auto-complete", () => {
  assert.equal(
    summarizeCampaignProgress([step("optional", false, true)]).complete,
    false,
  );
});
