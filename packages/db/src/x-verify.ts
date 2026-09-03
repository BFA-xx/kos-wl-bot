import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import type { PrismaClient, XEngagementKind } from "@prisma/client";
import { parseXStatusUrl } from "./raids.js";
import {
  callX,
  logXCacheHit,
  xMonthlyReadBudget,
  type XUsageAttribution,
} from "./x-usage.js";

// Spend control lives in x-usage.ts; re-exported so callers have one import.
export {
  X_USER_READ_USD,
  claimVerificationSlot,
  logXUsage,
  releaseXReads,
  reserveXReads,
  xBudgetMonth,
  xBudgetSnapshot,
  xMonthlyReadBudget,
  xRecheckCooldownMs,
  type VerificationSlot,
  type XBudgetSnapshot,
} from "./x-usage.js";

/**
 * Real X follow verification, shared by the dashboard and the bot.
 *
 * X retired its free tier in February 2026 and now bills per *resource
 * returned*, not per request. Two properties decide the design:
 *
 *   - A follow check returns one user object — the TARGET account — at $0.010.
 *     A like/repost check has to page the post's whole engager list, so it
 *     scales with the post, not the task. A post that goes viral bills like one.
 *   - Resources are deduplicated per 24-hour UTC window, so the target account
 *     is charged about once a day no matter how many members check it. That
 *     makes a follow task roughly a per-target-per-day cost rather than a
 *     per-member one. (X calls dedup a "soft guarantee", and it is not
 *     documented how it treats a per-viewer field like connection_status, so
 *     the ledger below counts every request and is an upper bound on spend.)
 *
 * Follows are therefore checked per member. Likes and reposts are checked by
 * SWEEPING the post's engager list once, caching it, and answering every
 * member from the cache — the cost lands on the post, not on the crowd, and
 * dedup makes re-sweeps within a day nearly free. The sweep is capped
 * (X_SWEEP_MAX_PAGES); when the cap cuts it short, a member missing from the
 * set is NOT a rejection, because they could be past the cap.
 *
 * X_COMMENT still attests: replies need the search endpoints, which is a
 * different cost and access story.
 *
 * The check authenticates as the *member* (their linked OAuth token) and looks
 * up the target account with `user.fields=connection_status`. X returns the
 * relationship between the authenticating user and the account looked up, so
 * "following" in that array is a first-party answer in a single request. It
 * also means rate limits are charged per member (900/15min each) rather than
 * against one shared app bucket, so a raffle rush doesn't self-throttle.
 *
 * Two guards stand in front of the spend, both fail-open to attest so a
 * billing problem can never wrongly reject a member who did the follow:
 *
 *   X_VERIFY_MODE=off|follow_only|full  kill switch, no deploy needed
 *   X_VERIFY_MONTHLY_READ_BUDGET        monthly ceiling on billable reads
 *   X_SWEEP_MAX_PAGES                   pages per engager sweep (100 each)
 *   X_SWEEP_TTL_MINUTES                 how long a cached sweep stays fresh
 */

const X_API = "https://api.x.com";
const ENC_PREFIX = "enc:v1:";

export type XVerifyMode = "off" | "follow_only" | "full";

/**
 * How a follow check came out. Everything except `following` / `not_following`
 * means "we could not get an answer" — callers must fall back to attest rather
 * than reject, or an outage becomes a wave of false rejections.
 */
export type XFollowOutcome =
  | "following"
  | "not_following"
  | "follow_pending"
  | "unlinked"
  | "disabled"
  | "budget_exhausted"
  | "token_expired"
  | "rate_limited"
  | "unavailable";

export interface XFollowResult {
  outcome: XFollowOutcome;
  /** The member's X handle, when they have one linked. */
  handle?: string | null;
  /** The member's X numeric id, when linked. */
  xUserId?: string | null;
  /** Billable user-object reads this check actually charged. */
  reads: number;
  /** Operator-facing detail for logs and stored evidence. */
  detail?: string;
}

export function xVerifyMode(): XVerifyMode {
  const raw = process.env.X_VERIFY_MODE;
  return raw === "follow_only" || raw === "full" ? raw : "off";
}

/**
 * Engager sweeps need an app-only bearer token: the set is shared by every
 * member, so charging it to one member's OAuth token (and rate limit) would be
 * arbitrary. Without a bearer token, likes/reposts stay on attest.
 */
export function xSweepConfigured(): boolean {
  return (
    xVerifyMode() === "full" &&
    xMonthlyReadBudget() > 0 &&
    Boolean(process.env.X_BEARER_TOKEN)
  );
}

/** Pages per sweep, 100 engagers each. Caps what one post can ever cost. */
export function xSweepMaxPages(): number {
  const raw = Number(process.env.X_SWEEP_MAX_PAGES ?? "20");
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 200) : 20;
}

/**
 * How long a cached engager set is trusted before it is swept again.
 *
 * Defaults to 6 hours, not minutes, because a re-sweep re-buys the post's
 * ENTIRE engager list — at 100 engagers that is $1.00 a time. A 10-minute TTL
 * across a 3-day raffle would sweep one post 432 times. Long TTLs are the
 * correct default here; the cost of staleness is a member waiting a few hours
 * for a late like to register, and they can still be attested in the meantime.
 */
export function xSweepTtlMs(): number {
  const raw = Number(process.env.X_SWEEP_TTL_MINUTES ?? "360");
  return (Number.isFinite(raw) && raw > 0 ? raw : 360) * 60_000;
}

export function xVerifyConfigured(): boolean {
  return (
    xVerifyMode() !== "off" &&
    xMonthlyReadBudget() > 0 &&
    Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET)
  );
}

/** Strip a leading @ and any x.com/twitter.com prefix from a configured handle. */
export function normalizeXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]!
    .trim();
}

/* ------------------------------------------------------------------ *
 * Token storage — same AES-256-GCM scheme and key the bot and dashboard
 * already use for wallets, so linked tokens round-trip across all three.
 * ------------------------------------------------------------------ */

function encryptSecret(plain: string): string {
  const keyHex = process.env.WALLET_ENCRYPTION_KEY;
  if (!keyHex) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const keyHex = process.env.WALLET_ENCRYPTION_KEY;
  if (!keyHex) return null;
  const [, , ivHex, tagHex, dataHex] = stored.split(":");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keyHex, "hex"),
      Buffer.from(ivHex!, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex!, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex!, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Spend ledger
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Member token
 * ------------------------------------------------------------------ */

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function usable(account: {
  accessToken: string | null;
  tokenExpiresAt: Date | null;
}): boolean {
  return Boolean(
    account.accessToken &&
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - 60_000 > Date.now(),
  );
}

async function refreshXToken(refreshToken: string): Promise<XTokenResponse | null> {
  const basic = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${X_API}/2/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.X_CLIENT_ID!,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as XTokenResponse;
}

/**
 * A currently-valid X access token for a member, refreshing through the stored
 * refresh token when it has aged out.
 *
 * X rotates refresh tokens on every use and invalidates the old one, so two
 * concurrent refreshes would leave one of them holding a dead token. The
 * advisory lock serializes rotation per member without holding a row lock, and
 * a second waiter re-reads the freshly stored token instead of refreshing again.
 */
export async function getValidXToken(
  db: PrismaClient,
  userId: string,
): Promise<string | null> {
  const account = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "X" } },
  });
  if (!account?.accessToken) return null;
  if (usable(account)) return decryptSecret(account.accessToken);

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`x-oauth:${userId}`}))`;

      const locked = await tx.connectedAccount.findUnique({
        where: { userId_provider: { userId, provider: "X" } },
      });
      if (!locked?.accessToken) return null;
      if (usable(locked)) return decryptSecret(locked.accessToken);
      if (!locked.refreshToken) return null;

      const stored = decryptSecret(locked.refreshToken);
      if (!stored) return null;

      const refreshed = await refreshXToken(stored);
      if (!refreshed) return null;

      await tx.connectedAccount.update({
        where: { userId_provider: { userId, provider: "X" } },
        data: {
          accessToken: encryptSecret(refreshed.access_token),
          refreshToken: refreshed.refresh_token
            ? encryptSecret(refreshed.refresh_token)
            : locked.refreshToken,
          tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      });
      return refreshed.access_token;
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

interface XUserLookup {
  data?: {
    id: string;
    username: string;
    connection_status?: string[];
  };
  errors?: { title?: string; detail?: string }[];
}

/**
 * Read the member's relationship to `targetHandle` straight from X.
 *
 * Anything other than a clean answer returns a non-terminal outcome so the
 * caller can fall back to attest. The one case that legitimately says "no" is
 * a successful lookup whose connection_status omits "following".
 */
export async function verifyXFollow(
  db: PrismaClient,
  input: { userId: string; targetHandle: string } & XUsageAttribution,
): Promise<XFollowResult> {
  const account = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId: input.userId, provider: "X" } },
    select: { externalId: true, handle: true },
  });
  if (!account) return { outcome: "unlinked", reads: 0 };

  const identity = { handle: account.handle, xUserId: account.externalId };
  const target = normalizeXHandle(input.targetHandle);
  if (!target) {
    return { ...identity, outcome: "unavailable", reads: 0, detail: "no target handle" };
  }
  if (!xVerifyConfigured()) {
    return { ...identity, outcome: "disabled", reads: 0 };
  }

  const token = await getValidXToken(db, input.userId);
  if (!token) {
    return { ...identity, outcome: "token_expired", reads: 0 };
  }

  const attribution: XUsageAttribution = {
    organizationId: input.organizationId,
    raffleId: input.raffleId,
    taskId: input.taskId,
    userId: input.userId,
    xUserId: account.externalId,
  };

  const call = await callX(
    db,
    `${X_API}/2/users/by/username/${encodeURIComponent(target)}?user.fields=connection_status`,
    // `cache` is absent from Node's RequestInit, but Next patches global fetch
    // and may cache GETs — a stale follow verdict would be worse than the cast.
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" } as RequestInit,
    {
      ...attribution,
      endpoint: "/2/users/by/username/:handle",
      operation: "follow_check",
      resources: 1,
    },
  );

  if (call.error === "budget_exhausted") {
    return { ...identity, outcome: "budget_exhausted", reads: 0 };
  }
  const res = call.res;
  if (!res) {
    return {
      ...identity,
      outcome: "unavailable",
      reads: call.chargedReads,
      detail: call.error ?? "no response",
    };
  }

  const reads = call.chargedReads;
  if (res.status === 401 || res.status === 403) {
    return { ...identity, outcome: "token_expired", reads, detail: `http ${res.status}` };
  }
  if (res.status === 429) {
    return { ...identity, outcome: "rate_limited", reads };
  }
  if (!res.ok) {
    return { ...identity, outcome: "unavailable", reads, detail: `http ${res.status}` };
  }

  const body = (await res.json()) as XUserLookup;
  if (!body.data) {
    return {
      ...identity,
      outcome: "unavailable",
      reads,
      detail: body.errors?.[0]?.detail ?? "target not found",
    };
  }

  // A missing connection_status means the app's access level didn't return the
  // relationship at all. That is not "they don't follow" — fall back to attest.
  if (!Array.isArray(body.data.connection_status)) {
    return {
      ...identity,
      outcome: "unavailable",
      reads,
      detail: "connection_status not returned for this access level",
    };
  }

  if (body.data.connection_status.includes("following")) {
    return { ...identity, outcome: "following", reads };
  }
  // A protected account holds the follow as a request; the member did their part.
  if (body.data.connection_status.includes("follow_request_sent")) {
    return { ...identity, outcome: "follow_pending", reads };
  }
  return { ...identity, outcome: "not_following", reads };
}

/* ------------------------------------------------------------------ *
 * Engager sweeps — likes and reposts
 * ------------------------------------------------------------------ */

/** Engagers read per page. X's maximum for both engagement endpoints. */
const SWEEP_PAGE_SIZE = 100;

export type XEngagementOutcome =
  | "engaged"
  | "not_engaged"
  | "unlinked"
  | "disabled"
  | "budget_exhausted"
  | "rate_limited"
  | "unavailable";

export interface XEngagementResult {
  outcome: XEngagementOutcome;
  handle?: string | null;
  xUserId?: string | null;
  reads: number;
  /** Whether the cached sweep covers the post's whole engager list. */
  complete?: boolean;
  actorCount?: number;
  detail?: string;
}

/** The X post id behind a task's configured tweet URL (or a bare id). */
export function xStatusId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return parseXStatusUrl(trimmed)?.statusId ?? null;
}

function sweepPath(kind: XEngagementKind): string {
  return kind === "LIKE" ? "liking_users" : "retweeted_by";
}

interface SweepPage {
  data?: { id: string }[];
  meta?: { next_token?: string };
}

interface SweepRun {
  actorIds: string[];
  complete: boolean;
  reads: number;
  stoppedBy?: "budget" | "rate_limit" | "error";
  detail?: string;
}

/**
 * The post's own like / repost count, used to tell a finished sweep from a
 * truncated one.
 *
 * X's engagement endpoints are documented as returning at most 100 engagers per
 * post, and they signal the end of a list by simply omitting the next cursor —
 * exactly what a complete list looks like. Trusting the missing cursor alone
 * would mark a 5,000-like post "complete" at engager 100 and then reject
 * everyone after that. Comparing against the real count is what makes a "no"
 * safe to act on. Costs one post read ($0.005) per sweep.
 */
async function fetchEngagementCount(
  db: PrismaClient,
  tweetId: string,
  kind: XEngagementKind,
  attribution: XUsageAttribution,
): Promise<{ count: number | null; reads: number }> {
  const call = await callX(
    db,
    `${X_API}/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=public_metrics`,
    {
      headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN!}` },
      cache: "no-store",
    } as RequestInit,
    {
      ...attribution,
      endpoint: "/2/tweets/:id",
      operation: "post_metrics",
      resources: 1,
    },
  );
  if (!call.res?.ok) return { count: null, reads: call.chargedReads };
  const body = (await call.res.json()) as {
    data?: { public_metrics?: { like_count?: number; retweet_count?: number } };
  };
  const metrics = body.data?.public_metrics;
  if (!metrics) return { count: null, reads: call.chargedReads };
  const count = kind === "LIKE" ? metrics.like_count : metrics.retweet_count;
  return {
    count: typeof count === "number" ? count : null,
    reads: call.chargedReads,
  };
}

/**
 * Page the post's engager list with the app-only bearer token.
 *
 * Stops at the page cap, at the monthly budget, or at a rate limit — each of
 * which leaves `complete` false, which is what stops a partial sweep from being
 * read as "these are all the engagers".
 */
async function runSweep(
  db: PrismaClient,
  tweetId: string,
  kind: XEngagementKind,
  attribution: XUsageAttribution,
): Promise<SweepRun> {
  const bearer = process.env.X_BEARER_TOKEN!;
  const maxPages = xSweepMaxPages();
  const actorIds: string[] = [];
  let reads = 0;
  let cursor: string | undefined;

  // Read the post's own count first, so "the cursor ran out" can be told apart
  // from "the endpoint stopped giving us engagers".
  const metrics = await fetchEngagementCount(db, tweetId, kind, attribution);
  reads += metrics.reads;
  const expected = metrics.count;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ max_results: String(SWEEP_PAGE_SIZE) });
    if (cursor) params.set("pagination_token", cursor);

    const call = await callX(
      db,
      `${X_API}/2/tweets/${encodeURIComponent(tweetId)}/${sweepPath(kind)}?${params}`,
      { headers: { authorization: `Bearer ${bearer}` }, cache: "no-store" } as RequestInit,
      {
        ...attribution,
        endpoint: `/2/tweets/:id/${sweepPath(kind)}`,
        operation: "engager_sweep_page",
        resources: SWEEP_PAGE_SIZE,
      },
    );
    reads += call.chargedReads;

    if (call.error === "budget_exhausted") {
      return { actorIds, complete: false, reads, stoppedBy: "budget" };
    }
    const res = call.res;
    if (!res) {
      return {
        actorIds,
        complete: false,
        reads,
        stoppedBy: "error",
        detail: call.error ?? "no response",
      };
    }
    if (res.status === 429) {
      return { actorIds, complete: false, reads, stoppedBy: "rate_limit" };
    }
    if (!res.ok) {
      return {
        actorIds,
        complete: false,
        reads,
        stoppedBy: "error",
        detail: `http ${res.status}`,
      };
    }

    const body = (await res.json()) as SweepPage;
    for (const actor of body.data ?? []) actorIds.push(actor.id);

    cursor = body.meta?.next_token;
    if (!cursor) {
      // The cursor ran out. That only means "saw everyone" if we actually
      // collected as many engagers as the post reports — allowing for the count
      // creeping up while we paged. Otherwise the endpoint truncated us.
      const seen = new Set(actorIds).size;
      const complete = expected === null ? false : seen >= expected;
      return {
        actorIds,
        complete,
        reads,
        ...(complete
          ? {}
          : {
              stoppedBy: "error" as const,
              detail:
                expected === null
                  ? "could not read the post's engagement count"
                  : `X returned ${seen} of ${expected} engagers`,
            }),
      };
    }
  }

  // Fell out of the loop still holding a cursor — the cap cut the sweep short.
  return { actorIds, complete: false, reads };
}

/**
 * Make sure a usable engager set exists for this post, sweeping if the cached
 * one has gone stale.
 *
 * The claim is a lease on `fetchedAt`: one verifier wins the conditional update
 * and does the sweep, everyone else answers from whatever is already cached
 * rather than stacking duplicate sweeps against a 75/15min rate limit. A sweep
 * that dies mid-flight simply leaves the lease to expire.
 */
async function ensureSweep(
  db: PrismaClient,
  tweetId: string,
  kind: XEngagementKind,
  attribution: XUsageAttribution,
): Promise<{ sweepId: string | null; reads: number; stoppedBy?: string; detail?: string }> {
  const staleBefore = new Date(Date.now() - xSweepTtlMs());
  const now = new Date();

  const claimed = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "x_engagement_sweeps"
      ("id", "tweetId", "kind", "fetchedAt", "complete", "actorCount", "createdAt", "updatedAt")
    VALUES (
      ${`xsw_${tweetId}_${kind}`}, ${tweetId}, ${kind}::"XEngagementKind",
      ${now}, false, 0, now(), now()
    )
    ON CONFLICT ("tweetId", "kind") DO UPDATE
      SET "fetchedAt" = ${now}, "updatedAt" = now()
      WHERE "x_engagement_sweeps"."fetchedAt" < ${staleBefore}
    RETURNING "id"
  `;

  const existing = await db.xEngagementSweep.findUnique({
    where: { tweetId_kind: { tweetId, kind } },
    select: { id: true },
  });
  if (!existing) return { sweepId: null, reads: 0, stoppedBy: "error" };

  // Someone else holds the lease (or the cache is still fresh) — use it as is.
  // Logged so the saving shows up next to the calls it replaced.
  if (claimed.length === 0) {
    await logXCacheHit(db, {
      ...attribution,
      endpoint: `/2/tweets/:id/${sweepPath(kind)}`,
      operation: "engager_sweep_page",
      outcome: "sweep_cache_hit",
    });
    return { sweepId: existing.id, reads: 0 };
  }

  const run = await runSweep(db, tweetId, kind, attribution);
  const unique = [...new Set(run.actorIds)];

  await db.$transaction([
    db.xEngagementActor.deleteMany({ where: { sweepId: existing.id } }),
    db.xEngagementActor.createMany({
      data: unique.map((xUserId) => ({ sweepId: existing.id, xUserId })),
      skipDuplicates: true,
    }),
    db.xEngagementSweep.update({
      where: { id: existing.id },
      data: {
        fetchedAt: new Date(),
        complete: run.complete,
        actorCount: unique.length,
      },
    }),
  ]);

  return {
    sweepId: existing.id,
    reads: run.reads,
    stoppedBy: run.stoppedBy,
    detail: run.detail,
  };
}

/**
 * Did this member like / repost the task's post?
 *
 * Answered from the cached engager set. The decisive rule is that only a
 * COMPLETE sweep can produce a "no" — if the page cap, the budget or a rate
 * limit cut the sweep short, a member who is simply past the cap must not be
 * rejected for it.
 */
export async function verifyXEngagement(
  db: PrismaClient,
  input: { userId: string; tweetUrl: string; kind: XEngagementKind } & XUsageAttribution,
): Promise<XEngagementResult> {
  const account = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId: input.userId, provider: "X" } },
    select: { externalId: true, handle: true },
  });
  if (!account) return { outcome: "unlinked", reads: 0 };

  const identity = { handle: account.handle, xUserId: account.externalId };
  if (!xSweepConfigured()) return { ...identity, outcome: "disabled", reads: 0 };

  const tweetId = xStatusId(input.tweetUrl);
  if (!tweetId) {
    return { ...identity, outcome: "unavailable", reads: 0, detail: "unparseable tweet url" };
  }

  const attribution: XUsageAttribution = {
    organizationId: input.organizationId,
    raffleId: input.raffleId,
    taskId: input.taskId,
    userId: input.userId,
    xUserId: account.externalId,
  };
  const { sweepId, reads, stoppedBy, detail } = await ensureSweep(
    db,
    tweetId,
    input.kind,
    attribution,
  );
  if (!sweepId) {
    return { ...identity, outcome: "unavailable", reads, detail: detail ?? "sweep failed" };
  }

  const sweep = await db.xEngagementSweep.findUnique({
    where: { id: sweepId },
    select: { complete: true, actorCount: true },
  });
  const hit = await db.xEngagementActor.findUnique({
    where: { sweepId_xUserId: { sweepId, xUserId: account.externalId } },
    select: { xUserId: true },
  });

  const shared = {
    ...identity,
    reads,
    complete: sweep?.complete ?? false,
    actorCount: sweep?.actorCount ?? 0,
  };

  if (hit) return { ...shared, outcome: "engaged" };
  if (sweep?.complete) return { ...shared, outcome: "not_engaged" };

  // Partial set: absence proves nothing.
  if (stoppedBy === "budget") return { ...shared, outcome: "budget_exhausted" };
  if (stoppedBy === "rate_limit") return { ...shared, outcome: "rate_limited" };
  return {
    ...shared,
    outcome: "unavailable",
    detail: detail ?? "engager list larger than the sweep cap",
  };
}
