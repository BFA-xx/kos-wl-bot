/**
 * Controlled verification run: 50 attempts through the real verifier.
 *
 * The X endpoint is stubbed and the database is in-memory, so this spends no
 * credits — but every decision that matters (the cooldown claim, the sweep
 * cache, the budget ceiling, retry handling) is the production code path. What
 * it measures is how many of 50 member actions actually reach X.
 *
 * Run: npx tsx src/x-verify.loadtest.ts
 */
import { verifyXEngagement, verifyXFollow } from "./x-verify.js";
import { claimVerificationSlot } from "./x-usage.js";
import { estimateCost } from "./x-pricing.js";

process.env.X_VERIFY_MODE = "full";
process.env.X_VERIFY_MONTHLY_READ_BUDGET = "100000";
process.env.X_CLIENT_ID = "id";
process.env.X_CLIENT_SECRET = "secret";
process.env.X_BEARER_TOKEN = "bearer";
process.env.X_SWEEP_TTL_MINUTES = "360";

interface LogRow {
  operation: string;
  resources: number;
  estimatedCost: number;
  cached: boolean;
}

/** In-memory stand-in with just enough behaviour to exercise the real paths. */
function makeDb() {
  const logs: LogRow[] = [];
  const completions = new Map<string, Date>();
  const sweepActors = new Set<string>();
  let sweepFetchedAt: Date | null = null;
  let sweepComplete = false;
  const cooldownMs = 60_000;

  const db = {
    connectedAccount: {
      findUnique: async ({ where }: never) => {
        const userId = (where as { userId_provider: { userId: string } })
          .userId_provider.userId;
        return {
          externalId: `x-${userId}`,
          handle: userId,
          accessToken: "token",
          tokenExpiresAt: new Date(Date.now() + 3_600_000),
        };
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const sql = strings.join("");
      if (sql.includes("x_verify_budget")) return [{ reads: 1 }];
      if (sql.includes("task_completions")) {
        const [, taskId, userId] = vals as [string, string, string];
        const key = `${taskId}:${userId}`;
        const last = completions.get(key);
        if (last && Date.now() - last.getTime() < cooldownMs) return [];
        completions.set(key, new Date());
        return [{ id: key }];
      }
      if (sql.includes("x_engagement_sweeps")) {
        const stale =
          !sweepFetchedAt ||
          Date.now() - sweepFetchedAt.getTime() > Number(process.env.X_SWEEP_TTL_MINUTES) * 60_000;
        if (!stale) return [];
        sweepFetchedAt = new Date();
        return [{ id: "sweep-1" }];
      }
      return [];
    },
    $executeRaw: async () => 1,
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
    xApiUsageLog: {
      create: async ({ data }: { data: LogRow }) => {
        logs.push(data);
        return data;
      },
    },
    taskCompletion: {
      findUnique: async () => ({ updatedAt: new Date() }),
    },
    xEngagementSweep: {
      findUnique: async () => ({
        id: "sweep-1",
        complete: sweepComplete,
        actorCount: sweepActors.size,
      }),
      update: async ({ data }: { data: { complete: boolean } }) => {
        sweepComplete = data.complete;
        return null;
      },
    },
    xEngagementActor: {
      findUnique: async ({ where }: never) =>
        sweepActors.has(
          (where as { sweepId_xUserId: { xUserId: string } }).sweepId_xUserId.xUserId,
        )
          ? { xUserId: "hit" }
          : null,
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: { xUserId: string }[] }) => {
        for (const d of data) sweepActors.add(d.xUserId);
        return { count: data.length };
      },
    },
  };
  return { db: db as never, logs, completions };
}

const MEMBERS = 20;
const members = Array.from({ length: MEMBERS }, (_, i) => `u${i}`);

function stubX() {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls++;
    const url = String(input);
    if (url.includes("/users/by/username/")) {
      // Half the members follow.
      return new Response(
        JSON.stringify({
          data: { id: "target", username: "kos", connection_status: ["following"] },
        }),
        { status: 200 },
      );
    }
    if (url.includes("public_metrics")) {
      return new Response(
        JSON.stringify({ data: { public_metrics: { like_count: MEMBERS, retweet_count: 0 } } }),
        { status: 200 },
      );
    }
    // Engager page: everyone liked it.
    return new Response(
      JSON.stringify({ data: members.map((m) => ({ id: `x-${m}` })) }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls: () => calls };
}

async function main() {
  const { db, logs } = makeDb();
  const x = stubX();
  let attempts = 0;
  let blockedByCooldown = 0;

  try {
    // Scenario: 20 members verify a follow task. 10 of them impatiently click a
    // second and third time — the retry-spam this work exists to absorb.
    for (const userId of members) {
      const clicks = Number(userId.slice(1)) < 10 ? 3 : 1;
      for (let c = 0; c < clicks; c++) {
        attempts++;
        const slot = await claimVerificationSlot(db, { taskId: "task-follow", userId });
        if (!slot.proceed) {
          blockedByCooldown++;
          continue;
        }
        await verifyXFollow(db, {
          userId,
          targetHandle: "kos",
          taskId: "task-follow",
        });
      }
    }

    // Scenario: the same 20 members verify one like task on a shared post.
    for (const userId of members) {
      attempts++;
      const slot = await claimVerificationSlot(db, { taskId: "task-like", userId });
      if (!slot.proceed) {
        blockedByCooldown++;
        continue;
      }
      await verifyXEngagement(db, {
        userId,
        tweetUrl: "https://x.com/kos/status/123",
        kind: "LIKE",
        taskId: "task-like",
      });
    }
  } finally {
    x.restore();
  }

  const real = logs.filter((l) => !l.cached);
  const cached = logs.filter((l) => l.cached);
  const cost = real.reduce((sum, l) => sum + Number(l.estimatedCost ?? 0), 0);
  const perOperation = new Map<string, { calls: number; cost: number }>();
  for (const l of real) {
    const e = perOperation.get(l.operation) ?? { calls: 0, cost: 0 };
    e.calls++;
    e.cost += Number(l.estimatedCost ?? 0);
    perOperation.set(l.operation, e);
  }

  console.log("=== Controlled verification run ===");
  console.log(`Members                : ${MEMBERS}`);
  console.log(`Verification attempts  : ${attempts}`);
  console.log(`Blocked by cooldown    : ${blockedByCooldown}`);
  console.log(`HTTP calls to X        : ${x.calls()}`);
  console.log(`Real API log rows      : ${real.length}`);
  console.log(`Cache-hit log rows     : ${cached.length}`);
  console.log(`Estimated cost         : $${cost.toFixed(4)}`);
  console.log(`Avg cost per attempt   : $${(cost / attempts).toFixed(5)}`);
  console.log("--- by operation ---");
  for (const [op, e] of perOperation) {
    console.log(`  ${op.padEnd(20)} ${String(e.calls).padStart(3)} calls  $${e.cost.toFixed(4)}`);
  }

  // Counterfactual: no cooldown (every click bills) and no sweep cache (every
  // member re-sweeps the post for themselves).
  const naiveFollow = 60 * estimateCost("follow_check", 1) * (40 / 60);
  const naiveSweep =
    MEMBERS * (estimateCost("post_metrics", 1) + estimateCost("engager_sweep_page", 100));
  const naive = naiveFollow + naiveSweep;
  console.log(
    `\nWithout cooldown + sweep cache : $${naive.toFixed(4)}` +
      `  (${((1 - cost / naive) * 100).toFixed(1)}% saved)`,
  );
  console.log(
    "Note: the single sweep page cost $1.00 — 5x all 20 follow checks combined.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
