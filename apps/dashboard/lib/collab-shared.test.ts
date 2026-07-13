import { describe, expect, it } from "vitest";
import {
  ACTIVE_COLLAB_STATUSES,
  COLLAB_STATUSES,
  displayCollabStatus,
  isCollabPriority,
  isCollabStatus,
  normalizeCollabName,
} from "./collab-shared";

describe("Collab Hub workflow constants", () => {
  it("keeps every requested pipeline stage in its operational order", () => {
    expect(COLLAB_STATUSES).toEqual([
      "LEAD",
      "REACHED_OUT",
      "NEGOTIATING",
      "CONFIRMED",
      "SCHEDULED",
      "HOSTING",
      "COLLECTING_WALLETS",
      "READY_FOR_SUBMISSION",
      "SUBMITTED",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(ACTIVE_COLLAB_STATUSES).not.toContain("COMPLETED");
    expect(ACTIVE_COLLAB_STATUSES).not.toContain("CANCELLED");
  });

  it("validates API enums and normalizes partner identity consistently", () => {
    expect(isCollabStatus("READY_FOR_SUBMISSION")).toBe(true);
    expect(isCollabStatus("READY")).toBe(false);
    expect(isCollabPriority("URGENT")).toBe(true);
    expect(normalizeCollabName("  Pudgy   Penguins ")).toBe("pudgy penguins");
    expect(displayCollabStatus("COLLECTING_WALLETS")).toBe(
      "Collecting wallets",
    );
  });
});
