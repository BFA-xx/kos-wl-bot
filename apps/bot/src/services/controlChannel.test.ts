import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "discord.js";

const CHANNEL = "123456789012345678";
const BOT_ID = "999888777666555444";

// config validates process.env at import time, so the channel has to be set
// before the module under test is pulled in.
process.env.CONTROL_CHANNEL_ID = CHANNEL;
const { handleControlMessage } = await import("./controlChannel.js");

function marker(over: Record<string, unknown> = {}) {
  const deleted: string[] = [];
  const message = {
    id: "m1",
    channelId: CHANNEL,
    content: "raffle #202 created",
    author: { id: BOT_ID },
    client: { user: { id: BOT_ID } },
    delete: async () => {
      deleted.push("m1");
    },
    ...over,
  } as unknown as Message;
  return { message, deleted };
}

/** The handler deletes best-effort and does not await it. */
const settle = () => new Promise((r) => setImmediate(r));

test("wakes the scheduler for a marker in the control channel", async () => {
  const reasons: string[] = [];
  const { message, deleted } = marker();

  handleControlMessage(message, (reason) => reasons.push(reason));

  assert.equal(reasons.length, 1);
  const [reason] = reasons;
  assert.ok(reason);
  assert.match(reason, /raffle #202 created/u);
  await settle();
  assert.deepEqual(deleted, ["m1"], "marker should be cleaned up");
});

test("ignores messages in every other channel", () => {
  const reasons: string[] = [];
  const { message } = marker({ channelId: "222222222222222222" });

  handleControlMessage(message, (reason) => reasons.push(reason));

  assert.deepEqual(reasons, []);
});

test("ignores a message someone else posted in the control channel", () => {
  const reasons: string[] = [];
  // Only something holding the bot token can post as the bot, so a human
  // chatting in the channel must not be able to drive the scheduler.
  const { message } = marker({ author: { id: "111111111111111111" } });

  handleControlMessage(message, (reason) => reasons.push(reason));

  assert.deepEqual(reasons, []);
});

test("a wake carries no instruction beyond its log label", () => {
  const reasons: string[] = [];
  const { message } = marker({
    content: "  raffle\n#202\tcreated  ".repeat(20),
  });

  handleControlMessage(message, (reason) => reasons.push(reason));

  assert.equal(reasons.length, 1);
  const [reason] = reasons;
  assert.ok(reason);
  // Bounded and flattened: the content reaches the logs and nothing else.
  assert.ok(reason.length <= 140, `label too long: ${reason.length}`);
  assert.ok(!reason.includes("\n"));
});

test("a failed delete does not break the wake", async () => {
  const reasons: string[] = [];
  const { message } = marker({
    delete: async () => {
      throw new Error("missing permissions");
    },
  });

  handleControlMessage(message, (reason) => reasons.push(reason));

  assert.equal(reasons.length, 1);
  await settle();
});
