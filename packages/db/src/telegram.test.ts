import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  autoPublishRaffleToTelegram,
  hashIntegrationToken,
  isTelegramAdmin,
  isTelegramMember,
  telegramDisplayName,
  telegramRaffleDefaults,
} from "./telegram.js";

test("hashes opaque integration capabilities deterministically", () => {
  assert.equal(hashIntegrationToken("one-time-secret").length, 64);
  assert.equal(
    hashIntegrationToken("one-time-secret"),
    hashIntegrationToken("one-time-secret"),
  );
  assert.notEqual(
    hashIntegrationToken("one-time-secret"),
    hashIntegrationToken("different-secret"),
  );
});

test("uses stable Telegram membership semantics", () => {
  assert.equal(isTelegramMember({ status: "member" }), true);
  assert.equal(
    isTelegramMember({ status: "restricted", is_member: true }),
    true,
  );
  assert.equal(
    isTelegramMember({ status: "restricted", is_member: false }),
    false,
  );
  assert.equal(isTelegramMember({ status: "left" }), false);
  assert.equal(isTelegramAdmin({ status: "administrator" }), true);
  assert.equal(isTelegramAdmin({ status: "member" }), false);
});

test("builds display names without requiring a public username", () => {
  assert.equal(
    telegramDisplayName({ id: 1, first_name: "Ada", last_name: "Lovelace" }),
    "Ada Lovelace",
  );
  assert.equal(telegramDisplayName({ id: 1, first_name: "Ada" }), "Ada");
});

test("normalizes Telegram raffle defaults conservatively", () => {
  assert.deepEqual(telegramRaffleDefaults(null), {
    membershipRequired: false,
    remainUntilEnd: false,
    winnerVisibility: "PUBLIC",
    autoAnnouncements: true,
    raffleTopicId: null,
    welcomeTopicId: null,
  });
  assert.deepEqual(
    telegramRaffleDefaults({
      membershipRequired: true,
      remainUntilEnd: true,
      winnerVisibility: "ADMIN_ONLY",
      autoAnnouncements: false,
    }),
    {
      membershipRequired: true,
      remainUntilEnd: true,
      winnerVisibility: "ADMIN_ONLY",
      autoAnnouncements: false,
      raffleTopicId: null,
      welcomeTopicId: null,
    },
  );
});

test("auto-publishes a posted raffle with membership and reminder defaults", async () => {
  const calls: {
    publication?: Record<string, unknown>;
    action?: Record<string, unknown>;
    rule?: Record<string, unknown>;
    deliveries?: Record<string, unknown>[];
  } = {};
  const tx = {
    telegramRafflePublication: {
      createMany: async (input: { data: Record<string, unknown>[] }) => {
        calls.publication = input.data[0];
        return { count: 1 };
      },
    },
    integrationActionToken: {
      create: async (input: { data: Record<string, unknown> }) => {
        calls.action = input.data;
        return input.data;
      },
    },
    raffleEligibilityRule: {
      create: async (input: { data: Record<string, unknown> }) => {
        calls.rule = input.data;
        return input.data;
      },
    },
    integrationDelivery: {
      createMany: async (input: { data: Record<string, unknown>[] }) => {
        calls.deliveries = input.data;
        return { count: input.data.length };
      },
    },
  };
  const db = {
    raffle: {
      findUnique: async () => ({
        id: 42,
        guildId: "guild-1",
        createdById: "user-1",
        status: "LIVE",
        endAt: new Date(Date.now() + 30 * 60_000),
      }),
    },
    telegramCommunity: {
      findMany: async () => [
        {
          id: "community-1",
          telegramChatId: "-1001",
          communityName: "KOS",
          defaultRaffleSettings: {
            membershipRequired: true,
            remainUntilEnd: true,
            winnerVisibility: "ANONYMOUS",
            autoAnnouncements: true,
          },
        },
      ],
    },
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  } as unknown as PrismaClient;

  assert.equal(await autoPublishRaffleToTelegram(db, 42), 1);
  assert.equal(calls.publication?.raffleId, 42);
  assert.equal(calls.publication?.winnerVisibility, "ANONYMOUS");
  assert.equal(calls.action?.action, "TELEGRAM_ENTER");
  assert.equal(calls.rule?.checkAt, "BOTH");
  assert.equal(calls.deliveries?.length, 2);
  assert.deepEqual(
    calls.deliveries?.map((delivery) => delivery.event),
    ["RAFFLE_CREATED", "RAFFLE_ENDING_SOON"],
  );
});

test("treats only a positive integer as a raffle topic", () => {
  assert.equal(telegramRaffleDefaults({}).raffleTopicId, null);
  assert.equal(telegramRaffleDefaults({ raffleTopicId: 12 }).raffleTopicId, 12);
  // Telegram sends thread ids as numbers, but stored JSON may round-trip them.
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: "12" }).raffleTopicId,
    12,
  );
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: 0 }).raffleTopicId,
    null,
  );
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: -3 }).raffleTopicId,
    null,
  );
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: 1.5 }).raffleTopicId,
    null,
  );
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: null }).raffleTopicId,
    null,
  );
  assert.equal(
    telegramRaffleDefaults({ raffleTopicId: "general" }).raffleTopicId,
    null,
  );
});

test("treats only a positive integer as a welcome topic", () => {
  assert.equal(telegramRaffleDefaults({}).welcomeTopicId, null);
  assert.equal(
    telegramRaffleDefaults({ welcomeTopicId: 44 }).welcomeTopicId,
    44,
  );
  assert.equal(
    telegramRaffleDefaults({ welcomeTopicId: "44" }).welcomeTopicId,
    44,
  );
  assert.equal(
    telegramRaffleDefaults({ welcomeTopicId: 0 }).welcomeTopicId,
    null,
  );
  assert.equal(
    telegramRaffleDefaults({ welcomeTopicId: "general" }).welcomeTopicId,
    null,
  );
});
