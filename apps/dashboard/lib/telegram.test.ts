import { afterEach, describe, expect, it, vi } from "vitest";
import {
  didTelegramMemberJoin,
  normalizeTelegramChatId,
  secureStringEqual,
  telegramConfig,
} from "@/lib/telegram";
import {
  escapeTelegramHtml,
  parseTelegramStartPayload,
  telegramUserMention,
} from "@/lib/telegram/format";
import { telegramRateWindowStart } from "@/lib/telegram/rate-limit";
import { parseTelegramModerationDuration } from "@/lib/telegram/admin";

describe("Telegram integration guards", () => {
  afterEach(() => vi.unstubAllEnvs());

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

  it("uses portable secret aliases when canonical values are empty", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("BOT_TOKEN", "portable-token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    vi.stubEnv("WEBHOOK_SECRET", "portable-secret");
    expect(telegramConfig()).toMatchObject({
      botToken: "portable-token",
      webhookSecret: "portable-secret",
    });
  });

  it("builds an HTML-safe immutable-id member mention", () => {
    expect(telegramUserMention(12345, "Ada <KOS> & team")).toBe(
      '<a href="tg://user?id=12345">Ada &lt;KOS&gt; &amp; team</a>',
    );
    expect(escapeTelegramHtml("KOS <Official>")).toBe("KOS &lt;Official&gt;");
  });

  it("accepts only explicitly supported deep-link payloads", () => {
    expect(parseTelegramStartPayload("raffle_177")).toEqual({
      kind: "raffle",
      raffleId: 177,
    });
    expect(parseTelegramStartPayload("invite_KOS_2026")).toEqual({
      kind: "invite",
      code: "KOS_2026",
    });
    expect(parseTelegramStartPayload("raffle_1;drop table")).toEqual({
      kind: "invalid",
    });
  });

  it("uses deterministic shared rate-limit windows", () => {
    expect(
      telegramRateWindowStart(new Date("2026-09-01T21:42:59.999Z")),
    ).toEqual(new Date("2026-09-01T21:42:00.000Z"));
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

  it("accepts bounded Telegram moderation durations", () => {
    expect(parseTelegramModerationDuration("10m")).toBe(600);
    expect(parseTelegramModerationDuration("2h")).toBe(7200);
    expect(parseTelegramModerationDuration("3d")).toBe(259200);
    expect(parseTelegramModerationDuration("forever")).toBeNull();
    expect(parseTelegramModerationDuration("9999d")).toBeNull();
  });
});
