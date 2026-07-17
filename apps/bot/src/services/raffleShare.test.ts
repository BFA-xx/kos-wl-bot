import assert from "node:assert/strict";
import test from "node:test";
import { publicRafflePath } from "../utils/raffleShare.js";

test("builds a branded collision-safe public raffle path", () => {
  assert.equal(
    publicRafflePath(66, "KOS", "Dorian Pepentice"),
    "/r/kos-x-dorian-pepentice-66",
  );
});
