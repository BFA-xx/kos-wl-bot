import assert from "node:assert/strict";
import test from "node:test";
import type { callTelegramApi } from "@kos/db";
import {
  isTopicUnavailable,
  raffleBannerForTelegram,
  sendToCommunity,
} from "./telegramService.js";

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

test("a raffle banner posts as a photo into the configured topic", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const call = (async (
    _t: string,
    method: string,
    body: Record<string, unknown>,
  ) => {
    calls.push({ method, body });
    return { ok: true, result: { message_id: 5 } };
  }) as unknown as typeof callTelegramApi;

  await sendToCommunity(
    "token",
    "-100",
    94,
    { photo: "https://raffle.koslabs.app/r/9/banner?v=1", caption: "hi" },
    call,
    "sendPhoto",
  );

  assert.equal(calls.length, 1);
  const [photo] = calls;
  assert.ok(photo);
  assert.equal(photo.method, "sendPhoto");
  assert.equal(photo.body.message_thread_id, 94);
  assert.equal(photo.body.chat_id, "-100");
});

test("a closed topic still falls back for a photo, not just text", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const call = (async (
    _t: string,
    method: string,
    body: Record<string, unknown>,
  ) => {
    calls.push({ method, body });
    if (body.message_thread_id) {
      return { ok: false, description: "Bad Request: TOPIC_CLOSED" };
    }
    return { ok: true, result: { message_id: 6 } };
  }) as unknown as typeof callTelegramApi;

  const sent = await sendToCommunity(
    "token",
    "-100",
    94,
    { photo: "https://example.test/b.png", caption: "hi" },
    call,
    "sendPhoto",
  );

  assert.equal(sent.ok, true);
  assert.equal(calls.length, 2);
  const retry = calls[1];
  assert.ok(retry);
  assert.equal(retry.method, "sendPhoto");
  assert.equal(retry.body.message_thread_id, undefined);
});

test("only https banners are handed to Telegram", () => {
  assert.equal(raffleBannerForTelegram(null), null);
  assert.equal(raffleBannerForTelegram("not a url"), null);
  assert.equal(raffleBannerForTelegram("http://insecure.test/b.png"), null);
  assert.equal(
    raffleBannerForTelegram("https://raffle.koslabs.app/r/9/banner?v=2"),
    "https://raffle.koslabs.app/r/9/banner?v=2",
  );
});
