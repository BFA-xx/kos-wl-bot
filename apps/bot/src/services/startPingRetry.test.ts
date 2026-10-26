import assert from "node:assert/strict";
import test from "node:test";
import { RaffleStatus } from "@kos/db";
import {
  START_PING_RETRY_WINDOW_MS,
  missedStartPingWhere,
} from "./startPingRetry.js";

test("targets live, posted, unpinged raffles that started recently", () => {
  const now = new Date("2026-10-26T09:00:00.000Z");
  const where = missedStartPingWhere(now);
  assert.equal(where.status, RaffleStatus.LIVE);
  assert.equal(where.startPinged, false);
  assert.deepEqual(where.startPing, { not: "none" });
  assert.deepEqual(where.messageId, { not: null });
  assert.deepEqual(where.endAt, { gt: now });
  assert.deepEqual(where.startAt, {
    gte: new Date(now.getTime() - START_PING_RETRY_WINDOW_MS),
  });
});
