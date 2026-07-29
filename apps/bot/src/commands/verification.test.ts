import assert from "node:assert/strict";
import test from "node:test";
import { verificationCommand } from "./verification.js";

test("registers the complete verification admin and code command surface", () => {
  const command = verificationCommand.data.toJSON() as {
    name: string;
    options?: Array<{
      name: string;
      options?: Array<{ name: string }>;
    }>;
  };
  assert.equal(command.name, "verification");
  assert.deepEqual(
    command.options?.map((option) => option.name),
    ["setup", "status", "publish", "code"],
  );
  const codeGroup = command.options?.find((option) => option.name === "code");
  assert.deepEqual(
    codeGroup?.options?.map((option) => option.name),
    ["create", "edit", "delete", "list"],
  );
});
