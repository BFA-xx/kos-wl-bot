import type { PrismaClient } from "@prisma/client";
import { estimateCost, xPrice, type XOperation } from "./x-pricing.js";
import { xBudgetSnapshot } from "./x-usage.js";

/**
 * Reporting over `x_api_usage_logs` — what verification actually cost, and what
 * caching saved.
 *
 * Every figure here is an ESTIMATE derived from our own call log and the rate
 * table in x-pricing.ts. X exposes no balance endpoint, so nothing in this file
 * can state a real credit balance and none of it claims to. The Developer
 * Console remains the only authority on money actually spent; treat a
 * divergence between the two as a signal that the rate table needs correcting.
 */

export interface XCostTotals {
  requests: number;
  cachedRequests: number;
  resources: number;
  estimatedCostUsd: number;
  /** What the same work would have cost with no caching at all. */
  estimatedCostWithoutCacheUsd: number;
  estimatedSavingsUsd: number;
  cacheHitRate: number;
}

function emptyTotals(): XCostTotals {
  return {
    requests: 0,
    cachedRequests: 0,
    resources: 0,
    estimatedCostUsd: 0,
    estimatedCostWithoutCacheUsd: 0,
    estimatedSavingsUsd: 0,
    cacheHitRate: 0,
  };
}

interface RawRow {
  operation: string;
  cached: boolean;
  requests: bigint | number;
  resources: bigint | number;
  cost: string | number | null;
}

const num = (v: bigint | number | string | null): number => Number(v ?? 0);

/**
 * What a cache hit would have cost had it been a real call. A skipped follow
 * check is one user object; a skipped sweep page is a full page.
 */
function avoidedCost(operation: string, hits: number): number {
  const op = operation as XOperation;
  const resourcesPerCall = op === "engager_sweep_page" ? 100 : 1;
  return estimateCost(op, resourcesPerCall * hits);
}

function foldTotals(rows: RawRow[]): XCostTotals {
  const totals = emptyTotals();
  for (const row of rows) {
    const requests = num(row.requests);
    if (row.cached) {
      totals.cachedRequests += requests;
      totals.estimatedCostWithoutCacheUsd += avoidedCost(row.operation, requests);
    } else {
      totals.requests += requests;
      totals.resources += num(row.resources);
      const cost = num(row.cost);
      totals.estimatedCostUsd += cost;
      totals.estimatedCostWithoutCacheUsd += cost;
    }
  }
  const attempts = totals.requests + totals.cachedRequests;
  totals.estimatedCostUsd = Number(totals.estimatedCostUsd.toFixed(4));
  totals.estimatedCostWithoutCacheUsd = Number(
    totals.estimatedCostWithoutCacheUsd.toFixed(4),
  );
  totals.estimatedSavingsUsd = Number(
    (totals.estimatedCostWithoutCacheUsd - totals.estimatedCostUsd).toFixed(4),
  );
  totals.cacheHitRate = attempts > 0 ? totals.cachedRequests / attempts : 0;
  return totals;
}

/** Epoch stands in for "all time" so one query shape serves every window. */
async function totalsSince(
  db: PrismaClient,
  since: Date = new Date(0),
): Promise<XCostTotals> {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT "operation", "cached",
           COUNT(*)::bigint                     AS requests,
           COALESCE(SUM("resources"),0)::bigint AS resources,
           COALESCE(SUM("estimatedCost"),0)     AS cost
    FROM "x_api_usage_logs"
    WHERE "createdAt" >= ${since}
    GROUP BY "operation", "cached"
  `;
  return foldTotals(rows);
}

export interface XOperationBreakdown {
  operation: string;
  requests: number;
  cachedRequests: number;
  resources: number;
  estimatedCostUsd: number;
}

export interface XCostOverview {
  budget: Awaited<ReturnType<typeof xBudgetSnapshot>>;
  allTime: XCostTotals;
  today: XCostTotals;
  week: XCostTotals;
  byOperation: XOperationBreakdown[];
  /** Distinct users verified all-time, for a cost-per-entrant figure. */
  distinctUsers: number;
  estimatedCostPerUserUsd: number;
  pricing: Record<string, number>;
}

export async function xCostOverview(db: PrismaClient): Promise<XCostOverview> {
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startOfWeek = new Date(startOfDay.getTime() - 6 * 86_400_000);

  const [budget, allTime, today, week, opRows, userRows] = await Promise.all([
    xBudgetSnapshot(db),
    totalsSince(db),
    totalsSince(db, startOfDay),
    totalsSince(db, startOfWeek),
    db.$queryRaw<RawRow[]>`
      SELECT "operation", "cached",
             COUNT(*)::bigint AS requests,
             COALESCE(SUM("resources"),0)::bigint AS resources,
             COALESCE(SUM("estimatedCost"),0) AS cost
      FROM "x_api_usage_logs"
      GROUP BY "operation", "cached"
    `,
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "x_api_usage_logs" WHERE "userId" IS NOT NULL
    `,
  ]);

  const byOperationMap = new Map<string, XOperationBreakdown>();
  for (const row of opRows) {
    const entry = byOperationMap.get(row.operation) ?? {
      operation: row.operation,
      requests: 0,
      cachedRequests: 0,
      resources: 0,
      estimatedCostUsd: 0,
    };
    if (row.cached) entry.cachedRequests += num(row.requests);
    else {
      entry.requests += num(row.requests);
      entry.resources += num(row.resources);
      entry.estimatedCostUsd += num(row.cost);
    }
    byOperationMap.set(row.operation, entry);
  }
  const byOperation = [...byOperationMap.values()]
    .map((e) => ({ ...e, estimatedCostUsd: Number(e.estimatedCostUsd.toFixed(4)) }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const distinctUsers = num(userRows[0]?.count ?? 0);

  return {
    budget,
    allTime,
    today,
    week,
    byOperation,
    distinctUsers,
    estimatedCostPerUserUsd:
      distinctUsers > 0
        ? Number((allTime.estimatedCostUsd / distinctUsers).toFixed(4))
        : 0,
    pricing: {
      USER_READ: xPrice("USER_READ"),
      POST_READ: xPrice("POST_READ"),
      LIKE_READ: xPrice("LIKE_READ"),
    },
  };
}

export interface XRaffleCost {
  raffleId: number;
  title: string;
  entrants: number;
  requests: number;
  cachedRequests: number;
  estimatedCostUsd: number;
  estimatedCostPerEntrantUsd: number;
}

/**
 * Cost attributed per raffle.
 *
 * Attribution runs through `raffle_tasks`, because a call is logged against a
 * task and a task can belong to more than one raffle. A shared task's cost
 * therefore appears under every raffle that requires it — the total across
 * raffles can exceed the all-time figure, and that is the honest presentation:
 * the second raffle genuinely did benefit from the same paid lookup.
 */
export async function xRaffleCosts(
  db: PrismaClient,
  limit = 25,
): Promise<XRaffleCost[]> {
  const rows = await db.$queryRaw<
    {
      raffleId: number;
      title: string | null;
      entrants: bigint;
      requests: bigint;
      cached: bigint;
      cost: string | null;
    }[]
  >`
    SELECT r."id"                                   AS "raffleId",
           r."title"                                AS "title",
           COUNT(DISTINCT p."userId")::bigint       AS "entrants",
           COUNT(*) FILTER (WHERE l."cached" = false)::bigint AS "requests",
           COUNT(*) FILTER (WHERE l."cached" = true)::bigint  AS "cached",
           COALESCE(SUM(l."estimatedCost") FILTER (WHERE l."cached" = false), 0) AS "cost"
    FROM "raffle_tasks" rt
    JOIN "raffles" r ON r."id" = rt."raffleId"
    JOIN "x_api_usage_logs" l ON l."taskId" = rt."taskId"
    LEFT JOIN "participants" p ON p."raffleId" = r."id"
    GROUP BY r."id", r."title"
    ORDER BY "cost" DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    const entrants = num(row.entrants);
    const cost = Number(num(row.cost).toFixed(4));
    return {
      raffleId: row.raffleId,
      title: row.title ?? `Raffle #${row.raffleId}`,
      entrants,
      requests: num(row.requests),
      cachedRequests: num(row.cached),
      estimatedCostUsd: cost,
      estimatedCostPerEntrantUsd:
        entrants > 0 ? Number((cost / entrants).toFixed(4)) : 0,
    };
  });
}

export interface XEntrantTaskTrace {
  taskId: string;
  taskTitle: string;
  taskType: string;
  status: string | null;
  source: "cache" | "api" | "none";
  apiCalls: number;
  cachedCalls: number;
  estimatedCostUsd: number;
  lastCheckedAt: Date | null;
  evidenceMethod: string | null;
}

/**
 * Per-entrant trace for the debug view: for one user, what each task cost and
 * whether the answer came from cache or from X.
 */
export async function xEntrantTrace(
  db: PrismaClient,
  userId: string,
): Promise<XEntrantTaskTrace[]> {
  const rows = await db.$queryRaw<
    {
      taskId: string;
      title: string;
      type: string;
      status: string | null;
      apiCalls: bigint;
      cachedCalls: bigint;
      cost: string | null;
      lastCheckedAt: Date | null;
      evidence: unknown;
    }[]
  >`
    SELECT t."id"    AS "taskId",
           t."title" AS "title",
           t."type"::text AS "type",
           c."status"::text AS "status",
           COUNT(l."id") FILTER (WHERE l."cached" = false)::bigint AS "apiCalls",
           COUNT(l."id") FILTER (WHERE l."cached" = true)::bigint  AS "cachedCalls",
           COALESCE(SUM(l."estimatedCost") FILTER (WHERE l."cached" = false), 0) AS "cost",
           MAX(l."createdAt") AS "lastCheckedAt",
           MIN(c."evidence"::text) AS "evidence"
    FROM "task_definitions" t
    LEFT JOIN "task_completions" c ON c."taskId" = t."id" AND c."userId" = ${userId}
    LEFT JOIN "x_api_usage_logs" l ON l."taskId" = t."id" AND l."userId" = ${userId}
    WHERE c."id" IS NOT NULL OR l."id" IS NOT NULL
    GROUP BY t."id", t."title", t."type", c."status"
    ORDER BY "cost" DESC, t."title" ASC
  `;

  return rows.map((row) => {
    const apiCalls = num(row.apiCalls);
    const cachedCalls = num(row.cachedCalls);
    let method: string | null = null;
    try {
      if (typeof row.evidence === "string") {
        method = (JSON.parse(row.evidence) as { method?: string }).method ?? null;
      }
    } catch {
      method = null;
    }
    return {
      taskId: row.taskId,
      taskTitle: row.title,
      taskType: row.type,
      status: row.status,
      source: apiCalls > 0 ? "api" : cachedCalls > 0 ? "cache" : "none",
      apiCalls,
      cachedCalls,
      estimatedCostUsd: Number(num(row.cost).toFixed(4)),
      lastCheckedAt: row.lastCheckedAt,
      evidenceMethod: method,
    };
  });
}
