import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getLegacyRaffleTasks } from "./legacy-raffle-tasks";

describe("legacy raffle step labels", () => {
  it("removes stored Discord placeholders without changing verification keys", () => {
    const label = "follow @plunderport: undefined like and repost: undefined";
    const hash = createHash("sha1")
      .update(`${label}\n`)
      .digest("hex")
      .slice(0, 12);

    expect(getLegacyRaffleTasks(304, { tasks: [{ label }] })).toEqual([
      {
        id: `social-304-0-${hash}`,
        key: `legacy:304:0:${hash}`,
        sharedKey: null,
        label: "follow @plunderport like and repost",
        url: null,
      },
    ]);
  });
});
