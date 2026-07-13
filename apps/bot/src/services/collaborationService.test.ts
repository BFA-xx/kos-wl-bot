import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanProjectName,
  normalizedProjectName,
  projectKey,
  raffleVariant,
  xProfileUrl,
} from "./collaborationService.js";

test("normalizes recurring project names without changing their display value", () => {
  assert.equal(cleanProjectName(" KOS x KUONnft? "), "KUONnft");
  assert.equal(normalizedProjectName(" KOS x KUONnft? "), "kuonnft");
  assert.equal(projectKey("KUONnft"), projectKey("KUON"));
});

test("detects raffle variants used by automatic Collab Hub tags", () => {
  assert.equal(raffleVariant("Project", "GTD spots"), "GTD");
  assert.equal(raffleVariant("Project", "FCFS"), "FCFS");
  assert.equal(raffleVariant("Project", "Whitelist"), "WL");
});

test("accepts project X profiles but rejects unrelated and unsafe URLs", () => {
  assert.equal(
    xProfileUrl("https://twitter.com/KUONnft"),
    "https://x.com/kuonnft",
  );
  assert.equal(xProfileUrl("https://x.com/intent/follow"), null);
  assert.equal(xProfileUrl("https://example.com/KUONnft"), null);
  assert.equal(xProfileUrl("javascript:alert(1)"), null);
});
