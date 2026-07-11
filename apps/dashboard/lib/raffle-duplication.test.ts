import { describe, expect, it, vi } from "vitest";
import {
  duplicateSchedule,
  duplicateSourceWhere,
  parseDuplicateVariant,
} from "./raffle-duplication";

describe("raffle duplication policy", () => {
  it("always scopes a source raffle to the requesting tenant guilds", () => {
    expect(duplicateSourceWhere(42, ["guild-a", "guild-b"])).toEqual({
      id: 42,
      guildId: { in: ["guild-a", "guild-b"] },
    });
  });

  it("does not accept unrecognized duplicate variants", () => {
    expect(parseDuplicateVariant("GTD")).toBe("GTD");
    expect(parseDuplicateVariant("FCFS")).toBe("FCFS");
    expect(parseDuplicateVariant("another-org")).toBe("SAME");
  });

  it("keeps the original duration but creates a fresh schedule", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const result = duplicateSchedule(
      new Date("2026-07-01T12:00:00.000Z"),
      new Date("2026-07-01T14:00:00.000Z"),
    );
    expect(result.startAt.toISOString()).toBe("2026-07-11T12:00:00.000Z");
    expect(result.endAt.toISOString()).toBe("2026-07-11T14:00:00.000Z");
    vi.useRealTimers();
  });
});
