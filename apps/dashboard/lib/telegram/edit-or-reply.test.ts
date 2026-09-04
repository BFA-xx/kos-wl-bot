import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { editOrReply, isUnchangedMessage } from "@/lib/telegram/edit-or-reply";

function makeCtx(editImpl: () => Promise<unknown>) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editMessageText = vi.fn().mockImplementation(editImpl);
  const ctx = {
    callbackQuery: { message: { message_id: 1 } },
    reply,
    editMessageText,
  } as unknown as Context;
  return { ctx, reply, editMessageText };
}

describe("editOrReply", () => {
  it("does not post a duplicate when nothing changed", async () => {
    // Pressing Refresh on an unchanged screen is the common case, and it used
    // to send a second copy of the same screen.
    const { ctx, reply, editMessageText } = makeCtx(() =>
      Promise.reject(
        new Error("Bad Request: message is not modified: the message content"),
      ),
    );
    await editOrReply(ctx, "queue", { reply_markup: undefined });
    expect(editMessageText).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });

  it("still recovers when the message genuinely cannot be edited", async () => {
    const { ctx, reply } = makeCtx(() =>
      Promise.reject(new Error("Bad Request: message to edit not found")),
    );
    await editOrReply(ctx, "queue", { reply_markup: undefined });
    expect(reply).toHaveBeenCalledOnce();
  });

  it("edits in place on success and sends nothing else", async () => {
    const { ctx, reply, editMessageText } = makeCtx(() =>
      Promise.resolve(true),
    );
    await editOrReply(ctx, "queue", { reply_markup: undefined });
    expect(editMessageText).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });

  it("sends a fresh message when the caller is not re-rendering", async () => {
    const { ctx, reply, editMessageText } = makeCtx(() =>
      Promise.resolve(true),
    );
    await editOrReply(ctx, "queue", { reply_markup: undefined }, false);
    expect(editMessageText).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });

  it("replies when there is no callback message to edit", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { reply, editMessageText: vi.fn() } as unknown as Context;
    await editOrReply(ctx, "queue", { reply_markup: undefined });
    expect(reply).toHaveBeenCalledOnce();
  });
});

describe("isUnchangedMessage", () => {
  it("recognises Telegram's wording", () => {
    expect(
      isUnchangedMessage(new Error("Bad Request: message is not modified")),
    ).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    expect(isUnchangedMessage(new Error("Bad Request: chat not found"))).toBe(
      false,
    );
    expect(isUnchangedMessage(undefined)).toBe(false);
    expect(isUnchangedMessage("message is not modified")).toBe(false);
  });
});
