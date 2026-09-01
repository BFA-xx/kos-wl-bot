import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { recordRaffleParticipant, removeRaffleParticipant } from "./raffles.js";

function fakeDatabase() {
  let entryCount = 0;
  const participants = new Set<string>();
  const transaction = {
    participant: {
      createMany: async ({
        data,
      }: {
        data: { raffleId: number; userId: string }[];
      }) => {
        const row = data[0];
        assert.ok(row);
        const key = `${row.raffleId}:${row.userId}`;
        if (participants.has(key)) return { count: 0 };
        participants.add(key);
        return { count: 1 };
      },
      deleteMany: async ({
        where,
      }: {
        where: { raffleId: number; userId: string };
      }) => {
        const removed = participants.delete(
          `${where.raffleId}:${where.userId}`,
        );
        return { count: removed ? 1 : 0 };
      },
    },
    raffle: {
      update: async ({ data }: { data: { entryCount: unknown } }) => {
        if (typeof data.entryCount === "number") entryCount = data.entryCount;
        else if ((data.entryCount as { increment?: number }).increment)
          entryCount += 1;
        return { entryCount };
      },
      findUniqueOrThrow: async () => ({ entryCount }),
    },
  };
  return {
    db: {
      $transaction: async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as unknown as PrismaClient,
    count: () => entryCount,
  };
}

test("participant insert is idempotent and increments once", async () => {
  const fake = fakeDatabase();
  const input = { raffleId: 7, userId: "42", username: "member" };
  assert.deepEqual(await recordRaffleParticipant(fake.db, input), {
    changed: true,
    entryCount: 1,
  });
  assert.deepEqual(await recordRaffleParticipant(fake.db, input), {
    changed: false,
    entryCount: null,
  });
  assert.equal(fake.count(), 1);
});

test("participant removal is idempotent and never underflows", async () => {
  const fake = fakeDatabase();
  await recordRaffleParticipant(fake.db, {
    raffleId: 7,
    userId: "42",
    username: "member",
  });
  assert.deepEqual(
    await removeRaffleParticipant(fake.db, { raffleId: 7, userId: "42" }),
    { changed: true, entryCount: 0 },
  );
  assert.deepEqual(
    await removeRaffleParticipant(fake.db, { raffleId: 7, userId: "42" }),
    { changed: false, entryCount: null },
  );
  assert.equal(fake.count(), 0);
});
