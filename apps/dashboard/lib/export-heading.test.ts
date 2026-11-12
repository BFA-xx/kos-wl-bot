import { describe, expect, it } from "vitest";
import { exportHeading, filenamePart } from "./export-heading";

describe("exportHeading", () => {
  it("uses the exporting community's name, not KOS", () => {
    expect(exportHeading("PRX", "VOLTOADS")).toBe("PRX X VOLTOADS");
  });
  it("falls back to KOS when the community has no name", () => {
    expect(exportHeading("  ", "VOLTOADS")).toBe("KOS X VOLTOADS");
  });
  it("makes filename-safe parts", () => {
    expect(filenamePart(" PRX Labs! ")).toBe("prx-labs");
  });
});
