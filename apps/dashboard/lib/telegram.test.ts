import { describe, expect, it } from "vitest";
import {
  didTelegramMemberJoin,
  normalizeTelegramChatId,
  secureStringEqual,
} from "@/lib/telegram";

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

  it("welcomes only real transitions into Telegram membership", () => {
    expect(
      didTelegramMemberJoin({ status: "left" }, { status: "member" }),
    ).toBe(true);
    expect(
      didTelegramMemberJoin(
        { status: "restricted", is_member: false },
        { status: "restricted", is_member: true },
      ),
    ).toBe(true);
    expect(
      didTelegramMemberJoin({ status: "member" }, { status: "administrator" }),
    ).toBe(false);
  });
});
