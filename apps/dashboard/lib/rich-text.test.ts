import { describe, expect, it } from "vitest";
import { richTextToPlainText, sanitizeRichText } from "./rich-text";

describe("rich collaboration notes", () => {
  it("preserves supported formatting", () => {
    expect(
      sanitizeRichText("<h3>Update</h3><p><strong>Confirmed</strong></p>"),
    ).toBe("<h3>Update</h3><p><strong>Confirmed</strong></p>");
  });

  it("removes scripts, event handlers, and unsafe links", () => {
    const clean = sanitizeRichText(
      '<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    );
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(richTextToPlainText(clean)).toContain("Safe");
  });
});
