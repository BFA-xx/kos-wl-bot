import { describe, expect, it } from "vitest";
import { approvalTableBlock } from "@/lib/telegram/admin";

describe("approval queue table", () => {
  it("aligns the columns to the widest handle", () => {
    const block = approvalTableBlock([
      { index: 1, tg: "shorty", x: "@a", invite: false },
      { index: 2, tg: "a_much_longer_name", x: "@b", invite: false },
    ]);
    const [header, first, second] = block
      .replace("<pre>", "")
      .replace("</pre>", "")
      .split("\n");
    // The X column starts at the same offset on every line, which is the whole
    // point of rendering this as a table rather than on buttons.
    expect(header?.indexOf("X")).toBe(first?.indexOf("@a"));
    expect(first?.indexOf("@a")).toBe(second?.indexOf("@b"));
  });

  it("keeps a two-digit index aligned with a one-digit one", () => {
    const block = approvalTableBlock([
      { index: 9, tg: "nine", x: "—", invite: false },
      { index: 10, tg: "ten", x: "—", invite: false },
    ]);
    const [, nine, ten] = block.split("\n");
    expect(nine?.indexOf("nine")).toBe(ten?.indexOf("ten"));
  });

  it("marks members who need an invite", () => {
    const block = approvalTableBlock([
      { index: 1, tg: "outside", x: "—", invite: true },
    ]);
    expect(block).toContain("+");
  });

  it("escapes a display name that tries to break out of the block", () => {
    // Display names come from Telegram, so they are attacker-controlled.
    const block = approvalTableBlock([
      { index: 1, tg: "</pre><b>evil", x: "—", invite: false },
    ]);
    expect(block).not.toContain("</pre><b>evil");
    expect(block).toContain("&lt;/pre&gt;&lt;b&gt;evil");
    // Exactly one opening and one closing tag survive.
    expect(block.match(/<pre>/gu)?.length).toBe(1);
    expect(block.match(/<\/pre>/gu)?.length).toBe(1);
  });
});
