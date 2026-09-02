import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  normalizeXHandle,
  reserveXReads,
  verifyXFollow,
  xBudgetMonth,
  xMonthlyReadBudget,
  verifyXEngagement,
  xSweepConfigured,
  xStatusId,
  xVerifyConfigured,
  xVerifyMode,
} from "./x-verify.js";

const ENV_KEYS = [
  "X_VERIFY_MODE",
  "X_VERIFY_MONTHLY_READ_BUDGET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "WALLET_ENCRYPTION_KEY",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

function enableVerification() {
  process.env.X_VERIFY_MODE = "follow_only";
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "1000";
  process.env.X_CLIENT_ID = "id";
  process.env.X_CLIENT_SECRET = "secret";
}

/** Minimal Prisma stand-in: a linked X account with a live token. */
function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    connectedAccount: {
      findUnique: async () => ({
        externalId: "42",
        handle: "member",
        accessToken: "plain-token",
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
      }),
    },
    // reserveXReads: succeed by returning a row.
    $queryRaw: async () => [{ reads: 1 }],
    ...overrides,
  } as never;
}

test("mode is off unless explicitly set to a known mode", () => {
  delete process.env.X_VERIFY_MODE;
  assert.equal(xVerifyMode(), "off");
  process.env.X_VERIFY_MODE = "everything";
  assert.equal(xVerifyMode(), "off", "unknown modes must not enable spending");
  process.env.X_VERIFY_MODE = "follow_only";
  assert.equal(xVerifyMode(), "follow_only");
  process.env.X_VERIFY_MODE = "full";
  assert.equal(xVerifyMode(), "full");
});

test("verification stays inert until mode, budget and credentials are all set", () => {
  enableVerification();
  assert.equal(xVerifyConfigured(), true);

  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "0";
  assert.equal(xVerifyConfigured(), false, "a zero budget disables spending");

  enableVerification();
  delete process.env.X_CLIENT_SECRET;
  assert.equal(xVerifyConfigured(), false, "missing credentials disables spending");

  enableVerification();
  process.env.X_VERIFY_MODE = "off";
  assert.equal(xVerifyConfigured(), false, "the kill switch wins");
});

test("a negative or unparseable budget reads as zero", () => {
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "-5";
  assert.equal(xMonthlyReadBudget(), 0);
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "abc";
  assert.equal(xMonthlyReadBudget(), 0);
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "250.9";
  assert.equal(xMonthlyReadBudget(), 250);
});

test("budget months are UTC calendar keys", () => {
  assert.equal(xBudgetMonth(new Date("2026-09-02T18:00:00Z")), "2026-09");
  assert.equal(xBudgetMonth(new Date("2026-01-31T23:59:59Z")), "2026-01");
});

test("handles are normalized from @, bare and full-URL forms", () => {
  assert.equal(normalizeXHandle("@KOS_Official"), "KOS_Official");
  assert.equal(normalizeXHandle("KOS_Official"), "KOS_Official");
  assert.equal(normalizeXHandle("https://x.com/KOS_Official"), "KOS_Official");
  assert.equal(normalizeXHandle("https://twitter.com/KOS_Official/"), "KOS_Official");
  assert.equal(normalizeXHandle("https://x.com/KOS_Official?s=20"), "KOS_Official");
  assert.equal(normalizeXHandle("  "), "");
});

test("a read costing more than the whole budget is refused without a query", async () => {
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "5";
  let queried = false;
  const db = { $queryRaw: async () => { queried = true; return []; } } as never;
  assert.equal(await reserveXReads(db, 6), false);
  assert.equal(queried, false);
});

test("an exhausted month returns no row and refuses the read", async () => {
  process.env.X_VERIFY_MONTHLY_READ_BUDGET = "100";
  const db = { $queryRaw: async () => [] } as never;
  assert.equal(await reserveXReads(db, 1), false);
});

test("an unlinked member is asked to link, and never spends a read", async () => {
  enableVerification();
  const db = fakeDb({ connectedAccount: { findUnique: async () => null } });
  const result = await verifyXFollow(db, { userId: "u1", targetHandle: "@kos" });
  assert.equal(result.outcome, "unlinked");
  assert.equal(result.reads, 0);
});

test("the kill switch short-circuits before any token or spend", async () => {
  enableVerification();
  process.env.X_VERIFY_MODE = "off";
  const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "@kos" });
  assert.equal(result.outcome, "disabled");
  assert.equal(result.reads, 0);
});

test("an exhausted budget stops the request before it is sent", async () => {
  enableVerification();
  const db = fakeDb({ $queryRaw: async () => [] }); // budget claim fails
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("must not call X once the budget is spent");
  }) as typeof fetch;
  try {
    const result = await verifyXFollow(db, { userId: "u1", targetHandle: "@kos" });
    assert.equal(result.outcome, "budget_exhausted");
    assert.equal(result.reads, 0);
  } finally {
    globalThis.fetch = original;
  }
});

/** Drive verifyXFollow against a canned X response. */
async function withXResponse(
  response: { status?: number; body?: unknown },
  run: (calledUrl: () => string) => Promise<void>,
) {
  const original = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    url = String(input);
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await run(() => url);
  } finally {
    globalThis.fetch = original;
  }
}

test("a following relationship verifies and charges one read", async () => {
  enableVerification();
  await withXResponse(
    { body: { data: { id: "9", username: "kos", connection_status: ["following"] } } },
    async (calledUrl) => {
      const result = await verifyXFollow(fakeDb(), {
        userId: "u1",
        targetHandle: "@kos",
      });
      assert.equal(result.outcome, "following");
      assert.equal(result.reads, 1);
      assert.equal(result.handle, "member");
      assert.match(calledUrl(), /\/2\/users\/by\/username\/kos\?user\.fields=connection_status$/);
    },
  );
});

test("a sent request to a protected account counts as done", async () => {
  enableVerification();
  await withXResponse(
    {
      body: {
        data: { id: "9", username: "kos", connection_status: ["follow_request_sent"] },
      },
    },
    async () => {
      const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
      assert.equal(result.outcome, "follow_pending");
    },
  );
});

test("an empty connection_status is a real 'not following'", async () => {
  enableVerification();
  await withXResponse(
    { body: { data: { id: "9", username: "kos", connection_status: [] } } },
    async () => {
      const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
      assert.equal(result.outcome, "not_following");
    },
  );
});

test("a missing connection_status is inconclusive, not a rejection", async () => {
  enableVerification();
  // What a lower access level returns: a valid user, no relationship field.
  await withXResponse(
    { body: { data: { id: "9", username: "kos" } } },
    async () => {
      const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
      assert.equal(
        result.outcome,
        "unavailable",
        "absent relationship data must fall back to attest, never reject",
      );
    },
  );
});

test("auth failures ask for a reconnect and rate limits stay retryable", async () => {
  enableVerification();
  await withXResponse({ status: 401 }, async () => {
    const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
    assert.equal(result.outcome, "token_expired");
  });
  await withXResponse({ status: 429 }, async () => {
    const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
    assert.equal(result.outcome, "rate_limited");
  });
  await withXResponse({ status: 503 }, async () => {
    const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
    assert.equal(result.outcome, "unavailable");
  });
});

test("a deleted or misspelled target is inconclusive rather than a rejection", async () => {
  enableVerification();
  await withXResponse(
    { body: { errors: [{ detail: "Could not find user with username: [nope]." }] } },
    async () => {
      const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "nope" });
      assert.equal(result.outcome, "unavailable");
    },
  );
});

test("a network failure is inconclusive but still counts the claimed read", async () => {
  enableVerification();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;
  try {
    const result = await verifyXFollow(fakeDb(), { userId: "u1", targetHandle: "kos" });
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.reads, 1, "a claimed read is not refunded — over-count is the safe side");
  } finally {
    globalThis.fetch = original;
  }
});

/* ---------------------------- engager sweeps ---------------------------- */

const SWEEP_ENV = ["X_BEARER_TOKEN", "X_SWEEP_MAX_PAGES", "X_SWEEP_TTL_MINUTES"] as const;
let savedSweep: Record<string, string | undefined> = {};

beforeEach(() => {
  savedSweep = Object.fromEntries(SWEEP_ENV.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of SWEEP_ENV) {
    if (savedSweep[k] === undefined) delete process.env[k];
    else process.env[k] = savedSweep[k]!;
  }
});

function enableSweeps() {
  enableVerification();
  process.env.X_VERIFY_MODE = "full";
  process.env.X_BEARER_TOKEN = "bearer";
}

/**
 * Prisma stand-in for the sweep path: a linked member, a claimable lease, and
 * an in-memory actor set the fake writes back into.
 */
function fakeSweepDb(opts: {
  memberXId?: string;
  claimLease?: boolean;
  actors?: string[];
  complete?: boolean;
} = {}) {
  const state = {
    actors: new Set(opts.actors ?? []),
    complete: opts.complete ?? false,
    actorCount: (opts.actors ?? []).length,
  };
  const db = {
    connectedAccount: {
      findUnique: async () => ({
        externalId: opts.memberXId ?? "member-1",
        handle: "member",
        accessToken: "plain-token",
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
      }),
    },
    // Budget claims succeed; the lease claim is controlled by claimLease.
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("x_engagement_sweeps")) {
        return opts.claimLease === false ? [] : [{ id: "sweep-1" }];
      }
      return [{ reads: 1 }];
    },
    xEngagementSweep: {
      findUnique: async () => ({
        id: "sweep-1",
        complete: state.complete,
        actorCount: state.actorCount,
      }),
      update: async ({ data }: { data: { complete: boolean; actorCount: number } }) => {
        state.complete = data.complete;
        state.actorCount = data.actorCount;
        return null;
      },
    },
    xEngagementActor: {
      findUnique: async ({ where }: { where: { sweepId_xUserId: { xUserId: string } } }) =>
        state.actors.has(where.sweepId_xUserId.xUserId)
          ? { xUserId: where.sweepId_xUserId.xUserId }
          : null,
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: { xUserId: string }[] }) => {
        state.actors = new Set(data.map((d) => d.xUserId));
        return { count: data.length };
      },
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  };
  return { db: db as never, state };
}

/** Queue canned X responses in order, and record the URLs requested. */
function queueX(responses: { status?: number; body?: unknown }[]) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  let i = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

const metrics = (likes: number, reposts = 0) => ({
  body: { data: { public_metrics: { like_count: likes, retweet_count: reposts } } },
});

test("sweeps are inert unless mode is full and a bearer token is set", () => {
  enableSweeps();
  assert.equal(xSweepConfigured(), true);
  process.env.X_VERIFY_MODE = "follow_only";
  assert.equal(xSweepConfigured(), false, "follow_only must not sweep");
  enableSweeps();
  delete process.env.X_BEARER_TOKEN;
  assert.equal(xSweepConfigured(), false, "sweeps need an app-only bearer token");
});

test("status ids are read from URLs and bare ids alike", () => {
  assert.equal(xStatusId("https://x.com/kos/status/1354143047324299264"), "1354143047324299264");
  assert.equal(xStatusId("https://twitter.com/kos/status/123?s=20"), "123");
  assert.equal(xStatusId("456"), "456");
  assert.equal(xStatusId("https://example.com/nope"), null);
});

test("a member found in the engager list is verified", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({ memberXId: "u-7" });
  const x = queueX([
    metrics(2),
    { body: { data: [{ id: "u-7" }, { id: "u-9" }] } },
  ]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.outcome, "engaged");
    assert.equal(result.complete, true);
    assert.match(x.urls[1]!, /\/2\/tweets\/999\/liking_users\?/);
  } finally {
    x.restore();
  }
});

test("a complete sweep can prove a member did NOT engage", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({ memberXId: "absent" });
  const x = queueX([metrics(2), { body: { data: [{ id: "u-7" }, { id: "u-9" }] } }]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.outcome, "not_engaged");
    assert.equal(result.complete, true);
  } finally {
    x.restore();
  }
});

test("an endpoint that truncates at 100 must not produce a false rejection", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({ memberXId: "absent" });
  // The post reports 5000 likes; X hands back 2 engagers and no cursor. That
  // shape is exactly what a finished list looks like — the count is what
  // catches it.
  const x = queueX([metrics(5000), { body: { data: [{ id: "u-7" }, { id: "u-9" }] } }]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.complete, false, "a short list against a big count is not complete");
    assert.notEqual(result.outcome, "not_engaged", "must never reject on a partial sweep");
    assert.equal(result.outcome, "unavailable");
  } finally {
    x.restore();
  }
});

test("an unreadable engagement count is treated as an incomplete sweep", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({ memberXId: "absent" });
  const x = queueX([{ status: 404 }, { body: { data: [{ id: "u-7" }] } }]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.complete, false);
    assert.notEqual(result.outcome, "not_engaged");
  } finally {
    x.restore();
  }
});

test("the page cap stops a huge post and leaves the sweep incomplete", async () => {
  enableSweeps();
  process.env.X_SWEEP_MAX_PAGES = "2";
  const { db } = fakeSweepDb({ memberXId: "absent" });
  // Every page hands back a cursor, so only the cap can end this.
  const x = queueX([
    metrics(100000),
    { body: { data: [{ id: "a" }], meta: { next_token: "c1" } } },
  ]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.complete, false);
    assert.equal(result.outcome, "unavailable");
    // 1 metrics call + exactly 2 pages, never more.
    assert.equal(x.urls.length, 3);
  } finally {
    x.restore();
  }
});

test("reposts sweep the retweeted_by endpoint", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({ memberXId: "u-7" });
  const x = queueX([metrics(0, 1), { body: { data: [{ id: "u-7" }] } }]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/777",
      kind: "REPOST",
    });
    assert.equal(result.outcome, "engaged");
    assert.match(x.urls[1]!, /\/2\/tweets\/777\/retweeted_by\?/);
  } finally {
    x.restore();
  }
});

test("a member whose lease is held by another verifier reads the cache", async () => {
  enableSweeps();
  const { db } = fakeSweepDb({
    memberXId: "u-7",
    claimLease: false,
    actors: ["u-7"],
    complete: true,
  });
  const x = queueX([{ status: 500 }]); // must not be reached
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "https://x.com/kos/status/999",
      kind: "LIKE",
    });
    assert.equal(result.outcome, "engaged");
    assert.equal(result.reads, 0, "a cached answer costs nothing");
    assert.equal(x.urls.length, 0, "a fresh cache must not hit X at all");
  } finally {
    x.restore();
  }
});

test("an unparseable tweet url never reaches X", async () => {
  enableSweeps();
  const { db } = fakeSweepDb();
  const x = queueX([{ status: 500 }]);
  try {
    const result = await verifyXEngagement(db, {
      userId: "m1",
      tweetUrl: "not a url",
      kind: "LIKE",
    });
    assert.equal(result.outcome, "unavailable");
    assert.equal(x.urls.length, 0);
  } finally {
    x.restore();
  }
});
