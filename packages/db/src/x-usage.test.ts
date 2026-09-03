import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { estimateCost, xPrice, xPricingTable } from "./x-pricing.js";
import { callX, claimVerificationSlot, releaseXReads, reserveXReads } from "./x-usage.js";
import { simulateRaffleCost } from "./x-simulate.js";

const ENV = [
  "X_VERIFY_MONTHLY_READ_BUDGET",
  "X_RECHECK_COOLDOWN_SECONDS",
  "X_PRICE_USER_READ",
  "X_PRICE_LIKE_READ",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "1000";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/** Records every statement so we can assert what the budget did. */
function ledgerDb(opts: { reserveOk?: boolean; claimOk?: boolean } = {}) {
  const calls = { reserve: 0, release: 0, logs: [] as Record<string, unknown>[] };
  const db = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("x_verify_budget")) {
        calls.reserve++;
        return opts.reserveOk === false ? [] : [{ reads: 1 }];
      }
      if (sql.includes("task_completions")) {
        return opts.claimOk === false ? [] : [{ id: "tc-1" }];
      }
      return [];
    },
    $executeRaw: async () => {
      calls.release++;
      return 1;
    },
    xApiUsageLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.logs.push(data);
        return data;
      },
    },
    taskCompletion: {
      findUnique: async () => ({ updatedAt: new Date() }),
    },
  };
  return { db: db as never, calls };
}

function stubFetch(responses: { status?: number; body?: unknown; throws?: boolean }[]) {
  const original = globalThis.fetch;
  let i = 0;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r.throws) throw new Error("socket hang up");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, count: () => count };
}

/* ------------------------------- pricing ------------------------------- */

test("pricing is centralized and env-overridable", () => {
  assert.equal(xPrice("USER_READ"), 0.01);
  process.env.X_PRICE_USER_READ = "0.004";
  assert.equal(xPrice("USER_READ"), 0.004, "the Console's live rate must win");
  assert.equal(xPricingTable().USER_READ, 0.004);
  delete process.env.X_PRICE_USER_READ;
  assert.equal(xPrice("USER_READ"), 0.01, "falls back to the published rate");
});

test("cost scales with resources, and unmetered operations are free", () => {
  assert.equal(estimateCost("follow_check", 1), 0.01);
  assert.equal(estimateCost("engager_sweep_page", 100), 1);
  assert.equal(estimateCost("post_metrics", 1), 0.005);
  assert.equal(estimateCost("token_refresh", 5), 0, "OAuth refresh is not a read");
  assert.equal(estimateCost("follow_check", 0), 0);
});

/* ------------------------------- budget -------------------------------- */

test("a claim larger than the whole budget never reaches the database", async () => {
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "5";
  const { db, calls } = ledgerDb();
  assert.equal(await reserveXReads(db, 6), false);
  assert.equal(calls.reserve, 0);
});

test("releasing is a no-op for a zero claim", async () => {
  const { db, calls } = ledgerDb();
  await releaseXReads(db, 0);
  assert.equal(calls.release, 0);
});

/* -------------------------------- callX -------------------------------- */

test("a successful call is charged once and logged once", async () => {
  const { db, calls } = ledgerDb();
  const f = stubFetch([{ status: 200 }]);
  try {
    const result = await callX(db, "https://x/api", {}, {
      endpoint: "/2/users/by/username/:handle",
      operation: "follow_check",
      resources: 1,
    });
    assert.equal(result.chargedReads, 1);
    assert.equal(result.attempts, 1);
    assert.equal(calls.release, 0, "a billed call keeps its claim");
    assert.equal(calls.logs.length, 1);
    assert.equal(calls.logs[0]!.estimatedCost, 0.01);
    assert.equal(calls.logs[0]!.resources, 1);
  } finally {
    f.restore();
  }
});

test("a rate limit is retried, then refunded because X cannot bill it", async () => {
  const { db, calls } = ledgerDb();
  const f = stubFetch([{ status: 429 }]);
  try {
    const result = await callX(db, "https://x/api", {}, {
      endpoint: "/2/tweets/:id/liking_users",
      operation: "engager_sweep_page",
      resources: 100,
    });
    assert.equal(f.count(), 3, "retries up to the attempt cap");
    assert.equal(result.chargedReads, 0, "nothing returned, nothing charged");
    assert.equal(calls.release, 1, "the claim goes back to the budget");
    assert.equal(calls.logs.length, 3, "every attempt is logged");
    for (const log of calls.logs) assert.equal(log.estimatedCost, 0);
  } finally {
    f.restore();
  }
});

test("a 404 is final — never retried, because a repeat buys the same failure", async () => {
  const { db, calls } = ledgerDb();
  const f = stubFetch([{ status: 404 }]);
  try {
    const result = await callX(db, "https://x/api", {}, {
      endpoint: "/2/tweets/:id",
      operation: "post_metrics",
      resources: 1,
    });
    assert.equal(f.count(), 1, "a 4xx must not be retried");
    assert.equal(result.chargedReads, 0);
    assert.equal(calls.release, 1);
  } finally {
    f.restore();
  }
});

test("an exhausted budget never opens a socket", async () => {
  const { db } = ledgerDb({ reserveOk: false });
  const f = stubFetch([{ status: 200 }]);
  try {
    const result = await callX(db, "https://x/api", {}, {
      endpoint: "/2/users/by/username/:handle",
      operation: "follow_check",
      resources: 1,
    });
    assert.equal(result.error, "budget_exhausted");
    assert.equal(f.count(), 0);
  } finally {
    f.restore();
  }
});

test("a network failure is retried and costs nothing", async () => {
  const { db, calls } = ledgerDb();
  const f = stubFetch([{ throws: true }]);
  try {
    const result = await callX(db, "https://x/api", {}, {
      endpoint: "/2/users/by/username/:handle",
      operation: "follow_check",
      resources: 1,
    });
    assert.equal(result.res, undefined);
    assert.equal(result.chargedReads, 0);
    assert.equal(calls.release, 1);
  } finally {
    f.restore();
  }
});

/* --------------------------- duplicate guard --------------------------- */

test("the first verify claims the slot", async () => {
  const { db } = ledgerDb({ claimOk: true });
  const slot = await claimVerificationSlot(db, { taskId: "t1", userId: "u1" });
  assert.equal(slot.proceed, true);
});

test("a second verify inside the cooldown is refused, not re-bought", async () => {
  // This is the leak the audit found: PENDING results fell through to a paid
  // call, so a member could bill a read on every click.
  const { db } = ledgerDb({ claimOk: false });
  const slot = await claimVerificationSlot(db, { taskId: "t1", userId: "u1" });
  assert.equal(slot.proceed, false);
  if (!slot.proceed) {
    assert.ok(slot.retryAfterSeconds > 0, "the member is told when to come back");
    assert.equal(slot.reason, "in_flight", "a claim seconds old reads as concurrent");
  }
});

test("a zero cooldown disables the guard for local debugging", async () => {
  process.env.X_RECHECK_COOLDOWN_SECONDS = "0";
  const { db } = ledgerDb({ claimOk: false });
  const slot = await claimVerificationSlot(db, { taskId: "t1", userId: "u1" });
  assert.equal(slot.proceed, true);
});

/* ------------------------------ simulator ------------------------------ */

test("follow cost scales with entrants; sweep cost does not", () => {
  // Past the point where entrants outnumber TTL windows, sweep cost is capped
  // by the raffle's length — that is the whole point of sharing one sweep.
  // engagersPerPost pinned: it defaults to the entrant count, and we are
  // isolating how cost moves with entrants alone.
  const mid = simulateRaffleCost({
    participants: 1_000, followTasks: 1, likeTasks: 1, engagersPerPost: 800,
  });
  const huge = simulateRaffleCost({
    participants: 10_000, followTasks: 1, likeTasks: 1, engagersPerPost: 800,
  });

  const followOf = (r: typeof mid) =>
    r.withCaching.lines.find((l) => l.label.startsWith("Follow"))!.estimatedCostUsd;
  const sweepOf = (r: typeof mid) =>
    r.withCaching.lines.find((l) => l.label.startsWith("Engager"))!.estimatedCostUsd;

  assert.equal(followOf(huge), followOf(mid) * 10, "follows are per entrant");
  assert.equal(
    sweepOf(huge),
    sweepOf(mid),
    "10x the entrants must not cost a penny more in sweeps",
  );
});

test("the sweep TTL, not the entrant count, is the cost lever", () => {
  const chatty = simulateRaffleCost({
    participants: 500, likeTasks: 1, sweepTtlMinutes: 10, raffleDurationHours: 72,
  });
  const patient = simulateRaffleCost({
    participants: 500, likeTasks: 1, sweepTtlMinutes: 1440, raffleDurationHours: 72,
  });
  assert.ok(
    patient.withCaching.estimatedCostUsd < chatty.withCaching.estimatedCostUsd / 10,
    "a longer TTL must cut sweep spend by orders of magnitude",
  );
});

test("caching is projected to save money, and the counterfactual is stated", () => {
  const r = simulateRaffleCost({
    participants: 500,
    followTasks: 2,
    likeTasks: 1,
    attemptsPerParticipant: 3,
  });
  assert.ok(r.withoutCaching.estimatedCostUsd > r.withCaching.estimatedCostUsd);
  assert.equal(
    r.estimatedSavingsUsd,
    Number((r.withoutCaching.estimatedCostUsd - r.withCaching.estimatedCostUsd).toFixed(4)),
  );
  assert.ok(
    r.assumptions.some((a) => a.includes("Developer Console")),
    "the estimate must disclose that it is not authoritative",
  );
});

test("winner re-validation is priced for winners only, not the whole field", () => {
  const withWinners = simulateRaffleCost({
    participants: 1000,
    followTasks: 1,
    winnerCount: 10,
  });
  const line = withWinners.withCaching.lines.find((l) => l.label.startsWith("Winner"))!;
  assert.equal(line.requests, 10, "10 winners x 1 follow task");
});

test("an empty raffle costs nothing and divides by zero safely", () => {
  const r = simulateRaffleCost({ participants: 0 });
  assert.equal(r.withCaching.estimatedCostUsd, 0);
  assert.equal(r.withCaching.costPerParticipantUsd, 0);
  assert.equal(r.withoutCaching.costPerParticipantUsd, 0);
});

test("a post past the sweep cap is flagged as capped rather than silently wrong", () => {
  const r = simulateRaffleCost({
    participants: 100,
    likeTasks: 1,
    engagersPerPost: 50_000,
    sweepMaxPages: 20,
  });
  assert.ok(
    r.assumptions.some((a) => a.includes("cap")),
    "the operator must be told certainty is capped, not just cost",
  );
});

/* ------------------------- advisory lock regression ------------------------- */

test("the advisory lock runs through executeRaw, not queryRaw", async () => {
  // pg_advisory_xact_lock() returns void. Prisma throws deserializing a void
  // column, so $queryRaw here silently broke every token refresh in production
  // while the mocked unit test kept passing. Assert the channel, not the mock.
  const { getValidXToken } = await import("./x-verify.js");
  const seen = { queryRaw: [] as string[], executeRaw: [] as string[] };

  const db = {
    connectedAccount: {
      findUnique: async () => ({
        accessToken: "stale",
        refreshToken: "r",
        tokenExpiresAt: new Date(Date.now() - 60_000), // forces the refresh path
      }),
      update: async () => null,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: async (s: TemplateStringsArray) => {
          seen.queryRaw.push(s.join(""));
          throw new Error("void column would fail to deserialize here");
        },
        $executeRaw: async (s: TemplateStringsArray) => {
          seen.executeRaw.push(s.join(""));
          return 1;
        },
        connectedAccount: {
          findUnique: async () => ({
            accessToken: "stale",
            refreshToken: "r",
            tokenExpiresAt: new Date(Date.now() - 60_000),
          }),
          update: async () => null,
        },
      }),
  } as never;

  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "fresh", expires_in: 7200 }), {
      status: 200,
    })) as typeof fetch;
  try {
    const token = await getValidXToken(db, "u1");
    assert.equal(token, "fresh", "a refresh must survive the advisory lock");
  } finally {
    globalThis.fetch = original;
  }

  assert.ok(
    seen.executeRaw.some((q) => q.includes("pg_advisory_xact_lock")),
    "the lock must be taken with $executeRaw",
  );
  assert.equal(
    seen.queryRaw.filter((q) => q.includes("pg_advisory_xact_lock")).length,
    0,
    "$queryRaw must never be used for a void-returning lock",
  );
});
