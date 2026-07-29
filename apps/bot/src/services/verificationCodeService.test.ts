import assert from "node:assert/strict";
import test from "node:test";
import {
  VerificationCodeError,
  assertCodeAvailable,
  normalizeVerificationCode,
  parseVerificationCodeState,
  parseVerificationExpiration,
  parseVerificationMaxUses,
} from "./verificationCodeService.js";

test("normalizes safe human-readable verification codes", () => {
  assert.equal(normalizeVerificationCode(" alpha-01 "), "ALPHA-01");
  assert.throws(
    () => normalizeVerificationCode("not valid!"),
    VerificationCodeError,
  );
});

test("parses unlimited and bounded max-use values", () => {
  assert.equal(parseVerificationMaxUses("unlimited"), null);
  assert.equal(parseVerificationMaxUses(""), null);
  assert.equal(parseVerificationMaxUses("250"), 250);
  assert.throws(() => parseVerificationMaxUses("0"), /whole number/);
});

test("parses expiration dates and rejects past dates", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  assert.equal(parseVerificationExpiration("never", now), null);
  assert.equal(
    parseVerificationExpiration("2026-08-01T18:00:00Z", now)?.toISOString(),
    "2026-08-01T18:00:00.000Z",
  );
  assert.throws(
    () => parseVerificationExpiration("2026-07-01T00:00:00Z", now),
    /future/,
  );
});

test("parses active and member-reuse state", () => {
  assert.deepEqual(parseVerificationCodeState("active, one-time"), {
    active: true,
    oneTimePerMember: true,
  });
  assert.deepEqual(parseVerificationCodeState("inactive, reusable"), {
    active: false,
    oneTimePerMember: false,
  });
  assert.deepEqual(parseVerificationCodeState("off, repeat"), {
    active: false,
    oneTimePerMember: false,
  });
});

test("checks inactive, expired, and exhausted codes", () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  assert.doesNotThrow(() =>
    assertCodeAvailable(
      { active: true, expiresAt: null, maxUses: 2, uses: 1 },
      now,
    ),
  );
  assert.throws(
    () =>
      assertCodeAvailable(
        { active: false, expiresAt: null, maxUses: null, uses: 0 },
        now,
      ),
    /inactive/,
  );
  assert.throws(
    () =>
      assertCodeAvailable(
        {
          active: true,
          expiresAt: new Date("2026-07-28T00:00:00Z"),
          maxUses: null,
          uses: 0,
        },
        now,
      ),
    /expired/,
  );
  assert.throws(
    () =>
      assertCodeAvailable(
        { active: true, expiresAt: null, maxUses: 2, uses: 2 },
        now,
      ),
    /maximum uses/,
  );
});
