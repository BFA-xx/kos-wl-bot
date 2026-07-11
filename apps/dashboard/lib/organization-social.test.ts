import { describe, expect, it } from "vitest";
import { normalizeXHandle, xProfileUrl } from "./organization-social";

describe("organization X profiles", () => {
  it("accepts handles and supported profile URLs", () => {
    expect(normalizeXHandle("@KOSLabs")).toBe("KOSLabs");
    expect(normalizeXHandle("https://x.com/KOSLabs?s=20")).toBe("KOSLabs");
    expect(normalizeXHandle("twitter.com/KOS_Labs/")).toBe("KOS_Labs");
  });

  it("rejects non-profile and invalid values", () => {
    expect(normalizeXHandle("https://example.com/KOSLabs")).toBeNull();
    expect(normalizeXHandle("not a valid handle")).toBeNull();
    expect(normalizeXHandle("this_handle_is_far_too_long")).toBeNull();
  });

  it("creates a canonical X profile URL", () => {
    expect(xProfileUrl("KOSLabs")).toBe("https://x.com/KOSLabs");
  });
});
