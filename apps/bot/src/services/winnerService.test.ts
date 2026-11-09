import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Client } from "discord.js";
import type { Prisma } from "@kos/db";

// Supply the same singleton the bot uses, without opening a real connection.
let transactionClient: Prisma.TransactionClient;
Object.assign(globalThis, {
  prisma: {
    raffleEligibilityRule: { findMany: async () => [] },
    $transaction: (callback: (db: Prisma.TransactionClient) => unknown) =>
      callback(transactionClient),
  },
});

const raffleId = 60;
const requestedAt = new Date("2026-11-09T08:00:00Z");
const options = {
  mode: "manual",
  winnerUserId: "old-winner",
  replacementUserId: "entrant",
} as const;

function heldRaffle(t: TestContext, eligible: boolean) {
  const raffle = {
    id: raffleId,
    status: "ENDED",
    guildId: "guild",
    holdResults: true,
    resultsPublishedAt: null,
    rerollRequestedAt: requestedAt as Date | null,
  };
  const tx = {
    $queryRaw: t.mock.fn(async () => [{ id: raffleId }]),
    raffle: {
      findUnique: t.mock.fn(async () => raffle),
      update: t.mock.fn(async () => {
        raffle.rerollRequestedAt = null;
        return raffle;
      }),
    },
    winner: {
      findMany: t.mock.fn(async () => [
        { id: 1, userId: "other-winner", username: "Other", position: 1 },
        { id: 2, userId: "old-winner", username: "Old", position: 2 },
      ]),
      updateMany: t.mock.fn(async (_args: unknown) => ({ count: 1 })),
      create: t.mock.fn(async (_args: unknown) => ({
        id: 4,
        userId: "entrant",
        username: "New",
      })),
    },
    participant: {
      findMany: t.mock.fn(async () =>
        eligible
          ? [{ id: 3, userId: "entrant", username: "New", weight: 1 }]
          : [],
      ),
    },
    log: { create: t.mock.fn(async (_args: unknown) => ({})) },
  };
  transactionClient = tx as unknown as Prisma.TransactionClient;
  return tx;
}

test("a queued manual replacement takes exactly the chosen slot and applies once", async (t) => {
  const { rerollWinners } = await import("./winnerService.js");
  const tx = heldRaffle(t, true);

  // A held raffle must not contact Discord or trigger public result side effects.
  assert.deepEqual(
    await rerollWinners(
      {} as Client,
      raffleId,
      "team-member",
      options,
      requestedAt,
    ),
    {
      replaced: [{ userId: "old-winner", username: "Old" }],
      added: [{ userId: "entrant", username: "New" }],
    },
  );
  assert.deepEqual(tx.winner.updateMany.mock.calls[0]?.arguments[0], {
    where: { id: 2, replaced: false },
    data: { replaced: true },
  });
  assert.deepEqual(tx.winner.create.mock.calls[0]?.arguments[0], {
    data: {
      raffleId,
      userId: "entrant",
      username: "New",
      position: 2,
      participantId: 3,
      fromReroll: true,
      manuallySelected: true,
    },
    select: { id: true, userId: true, username: true },
  });
  assert.equal(
    (tx.log.create.mock.calls[0]?.arguments[0] as { data: { actorId: string } })
      .data.actorId,
    "team-member",
  );
  assert.equal(
    await rerollWinners(
      {} as Client,
      raffleId,
      "team-member",
      options,
      requestedAt,
    ),
    null,
  );
  assert.equal(tx.winner.create.mock.callCount(), 1);
});

test("a queued entrant who became ineligible cannot remove the original winner", async (t) => {
  const { rerollWinners } = await import("./winnerService.js");
  const tx = heldRaffle(t, false);

  assert.equal(
    await rerollWinners(
      {} as Client,
      raffleId,
      "team-member",
      options,
      requestedAt,
    ),
    null,
  );
  assert.equal(tx.winner.updateMany.mock.callCount(), 0);
  assert.equal(tx.winner.create.mock.callCount(), 0);
  assert.equal(tx.raffle.update.mock.callCount(), 1);
});

test("a random reroll keeps occupied slots when the replacement pool runs out", async (t) => {
  const { rerollWinners } = await import("./winnerService.js");
  const tx = heldRaffle(t, true);

  const result = await rerollWinners(
    {} as Client,
    raffleId,
    "team-member",
    { mode: "all" },
    requestedAt,
  );

  assert.equal(result?.replaced.length, 1);
  assert.equal(result?.added.length, 1);
  assert.equal(tx.winner.updateMany.mock.callCount(), 1);
  assert.equal(tx.winner.create.mock.callCount(), 1);
});
