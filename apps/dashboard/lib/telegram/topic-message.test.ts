import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import {
  isTelegramTopicUnavailable,
  sendTelegramMessageWithTopicFallback,
} from "@/lib/telegram/topic-message";

type SendMessage = Context["api"]["sendMessage"];

describe("Telegram topic messages", () => {
  it("sends a welcome message into the configured topic", async () => {
    const send = vi.fn().mockResolvedValue({ message_id: 1 });

    await sendTelegramMessageWithTopicFallback(
      send as unknown as SendMessage,
      -1001,
      "Welcome",
      { parse_mode: "HTML" },
      77,
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      -1001,
      "Welcome",
      expect.objectContaining({ message_thread_id: 77 }),
    );
  });

  it("falls back to the main chat when the configured topic is gone", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        description: "Bad Request: message thread not found",
      })
      .mockResolvedValueOnce({ message_id: 2 });

    await sendTelegramMessageWithTopicFallback(
      send as unknown as SendMessage,
      -1001,
      "Welcome",
      { parse_mode: "HTML" },
      77,
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][2]).not.toHaveProperty("message_thread_id");
  });

  it("does not hide unrelated Telegram delivery errors", async () => {
    const error = { description: "Forbidden: bot was kicked" };
    const send = vi.fn().mockRejectedValue(error);

    await expect(
      sendTelegramMessageWithTopicFallback(
        send as unknown as SendMessage,
        -1001,
        "Welcome",
        {},
        77,
      ),
    ).rejects.toBe(error);
    expect(isTelegramTopicUnavailable(error)).toBe(false);
  });
});
