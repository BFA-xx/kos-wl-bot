import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommandRegistrationTarget } from "./registration.js";

test("uses configured guild registration for ordinary development deploys", () => {
  assert.deepEqual(resolveCommandRegistrationTarget([], "123"), {
    scope: "guild",
    guildId: "123",
  });
});

test("uses global registration when no development guild is configured", () => {
  assert.deepEqual(resolveCommandRegistrationTarget([], ""), {
    scope: "global",
    compatibilityGuildId: null,
  });
});

test("production global registration mirrors the configured compatibility guild", () => {
  assert.deepEqual(resolveCommandRegistrationTarget(["--global"], "123"), {
    scope: "global",
    compatibilityGuildId: "123",
  });
});
