import assert from "node:assert/strict";
import test from "node:test";
import { isTopicUnavailable, sendToCommunity } from "./telegramService.js";

test("recognises every way a raffle topic stops accepting posts", () => {
  for (const description of [
    "Bad Request: message thread not found",
    "Bad Request: TOPIC_DELETED",
    "Bad Request: TOPIC_CLOSED",
    "Bad Request: the topic is closed",
    "Bad Request: the chat is not a forum",
    "Bad Request: topics are disabled",
  ]) {
    assert.equal(isTopicUnavailable(description), true, description);
  }
});

test("does not mistake unrelated failures for a missing topic", () => {
  for (const description of [
    "Bad Request: chat not found",
    "Forbidden: bot was blocked by the user",
    "Bad Request: message is not modified",
    undefined,
  ]) {
    assert.equal(isTopicUnavailable(description), false, String(description));
  }
});

test("posts into the configured topic when the group has one", async () => {
  const calls: Record<string, unknown>[] = [];
  const call = async (
    _token: string,
    _method: string,
    body: Record<string, unknown> = {},
  ) => {
    calls.push(body);
    return { ok: true, result: { message_id: 1 } };
  };

  const sent = await sendToCommunity(
    "token",
    "-1001",
    77,
    { text: "raffle" },
    call as never,
  );

  assert.equal(sent.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls.at(0)?.message_thread_id, 77);
  assert.equal(calls.at(0)?.chat_id, "-1001");
});

test("falls back to the main chat when the topic is gone", async () => {
  const calls: Record<string, unknown>[] = [];
  const call = async (
    _token: string,
    _method: string,
    body: Record<string, unknown> = {},
  ) => {
    calls.push(body);
    return calls.length === 1
      ? { ok: false, description: "Bad Request: message thread not found" }
      : { ok: true, result: { message_id: 2 } };
  };

  const sent = await sendToCommunity(
    "token",
    "-1001",
    77,
    { text: "raffle" },
    call as never,
  );

  assert.equal(sent.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.at(0)?.message_thread_id, 77);
  // The retry must drop the thread, not merely repeat the same request.
  assert.equal(calls.at(1)?.message_thread_id, undefined);
});

test("does not retry a failure that has nothing to do with the topic", async () => {
  let attempts = 0;
  const call = async () => {
    attempts += 1;
    return { ok: false, description: "Bad Request: chat not found" };
  };

  const sent = await sendToCommunity(
    "token",
    "-1001",
    77,
    { text: "raffle" },
    call as never,
  );

  assert.equal(sent.ok, false);
  assert.equal(attempts, 1);
});

test("skips the threaded attempt entirely when no topic is configured", async () => {
  const calls: Record<string, unknown>[] = [];
  const call = async (
    _token: string,
    _method: string,
    body: Record<string, unknown> = {},
  ) => {
    calls.push(body);
    return { ok: true, result: { message_id: 3 } };
  };

  await sendToCommunity(
    "token",
    "-1001",
    null,
    { text: "raffle" },
    call as never,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls.at(0)?.message_thread_id, undefined);
});
