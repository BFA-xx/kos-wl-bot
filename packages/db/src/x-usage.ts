import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { estimateCost, xPrice, type XOperation } from "./x-pricing.js";

/**
 * Spend control and accounting for the X API — the layer underneath
 * `x-verify.ts`, which owns the checks themselves.
 *
 * Three separate jobs, deliberately kept apart because they answer different
 * questions and disagreeing with each other is useful signal:
 *
 *   x_verify_budget    a pre-claimed REQUEST budget. Claimed before a call goes
 *                      out so concurrent verifies cannot race past the ceiling.
 *                      An upper bound, not an invoice.
 *   x_api_usage_logs   what actually happened: one row per call and per cache
 *                      hit, with the observed cost. This is what the dashboard
 *                      and the simulator read.
 *   claimVerificationSlot   stops the same user+task being checked twice in
 *                      quick succession, which is the single largest source of
 *                      wasted credits (double-clicks and retry-spam on a task
 *                      the user has not completed yet).
 */

const DEFAULT_RECHECK_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 3;

/** USD per billable user-object read. Kept for callers that display a total. */
export const X_USER_READ_USD = xPrice("USER_READ");

export function xMonthlyReadBudget(): number {
  const raw = Number(process.env.X_VERIFY_MONTHLY_READ_BUDGET ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** UTC month key, "YYYY-MM" — the budget ledger's primary key. */
export function xBudgetMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * How long a non-VERIFIED X result is trusted before we pay to re-check.
 *
 * This is the anti-spam guard: without it, a member who has not done the task
 * can click Verify fifty times and bill fifty reads. Only applies to X tasks —
 * Discord checks are free and stay instant.
 */
export function xRecheckCooldownMs(): number {
  const raw = Number(
    process.env.X_RECHECK_COOLDOWN_SECONDS ?? String(DEFAULT_RECHECK_COOLDOWN_SECONDS),
  );
  return (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RECHECK_COOLDOWN_SECONDS) * 1000;
}

export interface XBudgetSnapshot {
  month: string;
  reads: number;
  budget: number;
  remaining: number;
  spentUsd: number;
}

export async function xBudgetSnapshot(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<XBudgetSnapshot> {
  const month = xBudgetMonth(now);
  const budget = xMonthlyReadBudget();
  const row = await db.xVerifyBudget.findUnique({ where: { month } });
  const reads = row?.reads ?? 0;
  return {
    month,
    reads,
    budget,
    remaining: Math.max(0, budget - reads),
    spentUsd: Number((reads * xPrice("USER_READ")).toFixed(2)),
  };
}

/**
 * Atomically claim `cost` reads against this month's ceiling.
 *
 * One statement, so concurrent verifies cannot both squeeze through the last
 * of the budget. Claims are released again only when we know for certain that
 * nothing was billed (see `releaseXReads`).
 */
export async function reserveXReads(
  db: PrismaClient,
  cost: number,
  now: Date = new Date(),
): Promise<boolean> {
  const budget = xMonthlyReadBudget();
  if (cost <= 0) return true;
  if (cost > budget) return false;

  const month = xBudgetMonth(now);
  const rows = await db.$queryRaw<{ reads: number }[]>`
    INSERT INTO "x_verify_budget" ("month", "reads", "updatedAt")
    VALUES (${month}, ${cost}, now())
    ON CONFLICT ("month") DO UPDATE
      SET "reads" = "x_verify_budget"."reads" + ${cost}, "updatedAt" = now()
      WHERE "x_verify_budget"."reads" + ${cost} <= ${budget}
    RETURNING "reads"
  `;
  return rows.length > 0;
}

/**
 * Hand a claim back after a call that X could not have billed — a rate limit,
 * a server error, or a request that never reached them.
 *
 * Only ever called for those outcomes. A claim for a call that returned data
 * stays spent, so the ceiling can only ever err toward under-spending.
 */
export async function releaseXReads(
  db: PrismaClient,
  cost: number,
  now: Date = new Date(),
): Promise<void> {
  if (cost <= 0) return;
  const month = xBudgetMonth(now);
  await db.$executeRaw`
    UPDATE "x_verify_budget"
    SET "reads" = GREATEST(0, "reads" - ${cost}), "updatedAt" = now()
    WHERE "month" = ${month}
  `;
}

/* ------------------------------------------------------------------ *
 * Usage log
 * ------------------------------------------------------------------ */

export interface XUsageAttribution {
  organizationId?: string | null;
  raffleId?: number | null;
  taskId?: string | null;
  userId?: string | null;
  xUserId?: string | null;
}

export interface XUsageEntry extends XUsageAttribution {
  endpoint: string;
  operation: XOperation;
  method?: string;
  resources?: number;
  cached?: boolean;
  statusCode?: number | null;
  durationMs?: number | null;
  outcome?: string | null;
  attempt?: number;
}

/**
 * Record one call — or one avoided call.
 *
 * Never throws: an accounting failure must not take down a verification. A
 * dropped row costs us a line in a report, whereas a thrown error costs a
 * member their task.
 */
export async function logXUsage(db: PrismaClient, entry: XUsageEntry): Promise<void> {
  const resources = entry.cached ? 0 : (entry.resources ?? 0);
  try {
    await db.xApiUsageLog.create({
      data: {
        endpoint: entry.endpoint,
        method: entry.method ?? "GET",
        operation: entry.operation,
        resources,
        estimatedCost: estimateCost(entry.operation, resources),
        cached: entry.cached ?? false,
        statusCode: entry.statusCode ?? null,
        durationMs: entry.durationMs ?? null,
        outcome: entry.outcome ?? null,
        organizationId: entry.organizationId ?? null,
        raffleId: entry.raffleId ?? null,
        taskId: entry.taskId ?? null,
        userId: entry.userId ?? null,
        xUserId: entry.xUserId ?? null,
        attempt: entry.attempt ?? 0,
      },
    });
  } catch {
    // Accounting is best-effort by design.
  }
}

/** Record a request we did not have to make. */
export async function logXCacheHit(
  db: PrismaClient,
  entry: Omit<XUsageEntry, "cached" | "resources">,
): Promise<void> {
  return logXUsage(db, { ...entry, cached: true, resources: 0 });
}

/* ------------------------------------------------------------------ *
 * The instrumented call
 * ------------------------------------------------------------------ */

export interface XCallSpec extends XUsageAttribution {
  /** Endpoint template with ids stripped, for grouping in reports. */
  endpoint: string;
  operation: XOperation;
  /** Billable resources a successful call can return. */
  resources: number;
  outcome?: string | null;
}

export interface XCallResult {
  res?: Response;
  /** Set when no HTTP response was obtained at all. */
  error?: string;
  /** Reads claimed against the budget and not returned. */
  chargedReads: number;
  attempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry only what a retry can fix, and only what X does not bill for. */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Perform one X API call with budget claiming, bounded retries and full
 * accounting.
 *
 * Retries are deliberately conservative. A 429 or a 5xx returns no resources,
 * so X does not bill it and retrying wastes no credits — but a 4xx would be
 * billed and repeating it would just buy the same failure twice, so it is never
 * retried. The budget is claimed once up front and handed back if the call
 * turns out to have been unbillable.
 */
export async function callX(
  db: PrismaClient,
  url: string,
  init: RequestInit,
  spec: XCallSpec,
): Promise<XCallResult> {
  if (!(await reserveXReads(db, spec.resources))) {
    await logXUsage(db, {
      ...spec,
      statusCode: null,
      outcome: "budget_exhausted",
      resources: 0,
      cached: false,
    });
    return { chargedReads: 0, attempts: 0, error: "budget_exhausted" };
  }

  let lastError: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let res: Response | undefined;
    let failure: string | undefined;
    try {
      res = await fetch(url, init);
    } catch (err) {
      failure = (err as Error).message;
    }
    const durationMs = Date.now() - startedAt;
    const billed = Boolean(res?.ok);

    await logXUsage(db, {
      ...spec,
      resources: billed ? spec.resources : 0,
      cached: false,
      statusCode: res?.status ?? null,
      durationMs,
      outcome: failure ? `network: ${failure}` : (spec.outcome ?? null),
      attempt,
    });

    if (res && !retryable(res.status)) {
      // A 4xx that is not a rate limit is final, billed or not.
      if (!res.ok) await releaseXReads(db, spec.resources);
      return {
        res,
        chargedReads: res.ok ? spec.resources : 0,
        attempts: attempt + 1,
      };
    }
    lastError = failure ?? `http ${res?.status}`;

    if (attempt < MAX_ATTEMPTS - 1) {
      // Exponential backoff with jitter: 400ms, 800ms (+/- 25%).
      const base = 400 * 2 ** attempt;
      await sleep(base + Math.floor(Math.random() * base * 0.5) - base * 0.25);
    } else if (res) {
      // Out of attempts but we do have a response to hand back.
      await releaseXReads(db, spec.resources);
      return { res, chargedReads: 0, attempts: attempt + 1 };
    }
  }

  // Never got a usable response — nothing was billed.
  await releaseXReads(db, spec.resources);
  return { chargedReads: 0, attempts: MAX_ATTEMPTS, error: lastError };
}

/* ------------------------------------------------------------------ *
 * Duplicate-request protection
 * ------------------------------------------------------------------ */

export type VerificationSlot =
  | { proceed: true }
  | { proceed: false; reason: "cooldown" | "in_flight"; retryAfterSeconds: number };

/**
 * Claim the right to spend credits verifying one user's one task.
 *
 * Two problems, one mechanism. A conditional UPDATE on the completion row acts
 * as both a cooldown (a result checked seconds ago is reused rather than
 * re-bought) and an in-flight lock (a double-click loses the race and is told
 * so, instead of firing a second paid call). The same lease pattern the engager
 * sweeps use — no long-held lock, and nothing to leak if a request dies.
 *
 * VERIFIED and NEEDS_REVIEW rows are never claimed: callers short-circuit those
 * before reaching here, and re-checking a pass would be pure waste.
 */
/**
 * Hand a claimed slot back when the check cost nothing.
 *
 * The cooldown exists to stop a paid answer being re-bought. If we never
 * reached X — no linked account, a dead token, an outage, the budget spent —
 * there is nothing to protect, and making the member wait a minute to retry is
 * pure friction. Only definitive answers keep their cooldown.
 */
export async function releaseVerificationSlot(
  db: PrismaClient,
  input: { taskId: string; userId: string },
): Promise<void> {
  await db.$executeRaw`
    UPDATE "task_completions"
    SET "updatedAt" = to_timestamp(0)
    WHERE "taskId" = ${input.taskId}
      AND "userId" = ${input.userId}
      AND "status" NOT IN ('VERIFIED', 'NEEDS_REVIEW')
  `;
}

export async function claimVerificationSlot(
  db: PrismaClient,
  input: { taskId: string; userId: string; cooldownMs?: number },
): Promise<VerificationSlot> {
  const cooldownMs = input.cooldownMs ?? xRecheckCooldownMs();
  if (cooldownMs <= 0) return { proceed: true };

  const staleBefore = new Date(Date.now() - cooldownMs);
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "task_completions" ("id", "taskId", "userId", "status", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${input.taskId}, ${input.userId}, 'PENDING', now(), now())
    ON CONFLICT ("taskId", "userId") DO UPDATE
      SET "updatedAt" = now()
      WHERE "task_completions"."updatedAt" < ${staleBefore}
        AND "task_completions"."status" NOT IN ('VERIFIED', 'NEEDS_REVIEW')
    RETURNING "id"
  `;
  if (rows.length > 0) return { proceed: true };

  // Lost the race, or checked too recently. Work out which, for the message.
  const existing = await db.taskCompletion.findUnique({
    where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
    select: { updatedAt: true },
  });
  const elapsed = existing ? Date.now() - existing.updatedAt.getTime() : 0;
  const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
  return {
    proceed: false,
    reason: elapsed < 2_000 ? "in_flight" : "cooldown",
    retryAfterSeconds,
  };
}
