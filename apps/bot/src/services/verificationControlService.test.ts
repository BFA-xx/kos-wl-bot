import assert from "node:assert/strict";
import test from "node:test";
import { VerificationSettingsError } from "./verificationSettingsService.js";
import { formatVerificationControlError } from "./verificationControlService.js";

test("surfaces dashboard readiness details without leaking oversized errors", () => {
  assert.equal(
    formatVerificationControlError(
      new VerificationSettingsError("Not ready.", [
        "Choose a verification channel.",
        "Create an active code.",
      ]),
    ),
    "Not ready. Choose a verification channel. Create an active code.",
  );
  assert.equal(
    formatVerificationControlError(new Error("x".repeat(2_000))).length,
    1_800,
  );
});
