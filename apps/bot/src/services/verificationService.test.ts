import assert from "node:assert/strict";
import test from "node:test";
import { renderVerificationMessage } from "./verificationService.js";

test("renders configured verification success placeholders", () => {
  assert.equal(
    renderVerificationMessage(
      "Welcome {user} to {server}. Code: {code}. Roles: {roles}",
      {
        userId: "123",
        guildName: "KOS Raffle",
        code: "ALPHA",
        roleIds: ["456", "789"],
      },
    ),
    "Welcome <@123> to KOS Raffle. Code: ALPHA. Roles: <@&456>, <@&789>",
  );
});

test("renders useful defaults when code and roles are not required", () => {
  assert.equal(
    renderVerificationMessage("{code} · {roles}", {
      userId: "123",
      guildName: "KOS",
      code: null,
      roleIds: [],
    }),
    "Not required · Member access",
  );
});
