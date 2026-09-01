import { describe, expect, it } from "vitest";
import { normalizeTelegramChatId, secureStringEqual } from "@/lib/telegram";

describe("Telegram integration guards", () => {
  it("accepts Telegram numeric chat ids without coercing precision", () => {
    expect(normalizeTelegramChatId("-1001234567890123")).toBe(
      "-1001234567890123",
    );
    expect(normalizeTelegramChatId("chat-name")).toBeNull();
  });

  it("compares webhook secrets without accepting missing or partial values", () => {
    expect(secureStringEqual("secret-value", "secret-value")).toBe(true);
    expect(secureStringEqual("secret-value", "secret-valu")).toBe(false);
    expect(secureStringEqual(null, null)).toBe(false);
  });
});
