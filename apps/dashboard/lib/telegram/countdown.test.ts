import { describe, expect, it } from "vitest";
import { telegramCountdown } from "@/lib/telegram/format";

const now = new Date("2026-09-03T12:00:00.000Z");

describe("telegramCountdown", () => {
  it("speaks in the largest two useful units", () => {
    expect(telegramCountdown(new Date("2026-09-05T15:30:00.000Z"), now)).toBe(
      "in 2d 3h",
    );
    expect(telegramCountdown(new Date("2026-09-03T15:20:00.000Z"), now)).toBe(
      "in 3h 20m",
    );
    expect(telegramCountdown(new Date("2026-09-03T12:45:00.000Z"), now)).toBe(
      "in 45m",
    );
  });

  it("does not render a bare zero as it closes", () => {
    expect(telegramCountdown(new Date("2026-09-03T12:00:30.000Z"), now)).toBe(
      "in under a minute",
    );
  });

  it("reads past deadlines as elapsed", () => {
    expect(telegramCountdown(new Date("2026-09-03T09:00:00.000Z"), now)).toBe(
      "3h 0m ago",
    );
  });
});
