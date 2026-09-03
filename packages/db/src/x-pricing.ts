/**
 * X API pricing, in one place.
 *
 * Rates are per *resource returned* (reads) or per request (writes) under X's
 * pay-per-use model, which replaced the free tier in February 2026. Every cost
 * figure in the app — the budget ledger, the usage log, the admin dashboard,
 * the raffle simulator — resolves through here, so a price change is one edit
 * or one env var rather than a grep.
 *
 * Each rate is env-overridable because X's published table and the Developer
 * Console's live per-endpoint rates are not always in step, and we would rather
 * correct a number than ship a deploy.
 */

export type XPriceKey =
  | "USER_READ"
  | "POST_READ"
  | "LIKE_READ"
  | "FOLLOWERS_READ"
  | "OWNED_READ";

/** Published list rates, USD per resource. */
const DEFAULT_PRICING: Record<XPriceKey, number> = {
  USER_READ: 0.01,
  POST_READ: 0.005,
  LIKE_READ: 0.001,
  FOLLOWERS_READ: 0.01,
  OWNED_READ: 0.001,
};

const ENV_KEYS: Record<XPriceKey, string> = {
  USER_READ: "X_PRICE_USER_READ",
  POST_READ: "X_PRICE_POST_READ",
  LIKE_READ: "X_PRICE_LIKE_READ",
  FOLLOWERS_READ: "X_PRICE_FOLLOWERS_READ",
  OWNED_READ: "X_PRICE_OWNED_READ",
};

export function xPrice(key: XPriceKey): number {
  const raw = process.env[ENV_KEYS[key]];
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_PRICING[key];
}

export function xPricingTable(): Record<XPriceKey, number> {
  return {
    USER_READ: xPrice("USER_READ"),
    POST_READ: xPrice("POST_READ"),
    LIKE_READ: xPrice("LIKE_READ"),
    FOLLOWERS_READ: xPrice("FOLLOWERS_READ"),
    OWNED_READ: xPrice("OWNED_READ"),
  };
}

/**
 * The operations we actually perform, and what each one bills.
 *
 * `resources` is what a single call charges at the unit rate:
 *   - a follow check returns exactly one user object
 *   - a metrics read returns one post
 *   - a sweep page returns up to 100 engagers, and we bill the full page
 *     because we asked for it (the safe direction to be wrong in)
 */
export type XOperation =
  | "follow_check"
  | "post_metrics"
  | "engager_sweep_page"
  | "token_refresh";

export const OPERATION_PRICE: Record<XOperation, XPriceKey | null> = {
  follow_check: "USER_READ",
  post_metrics: "POST_READ",
  // Engager pages return user objects. X lists a cheaper "Like: Read" class at
  // $0.001 but never says which endpoints it covers, so we price the pessimistic
  // reading and let X_PRICE_LIKE_READ correct it once the Console confirms.
  engager_sweep_page: "USER_READ",
  // OAuth token refresh is not a metered read.
  token_refresh: null,
};

/** USD an operation costs for `resources` resources. */
export function estimateCost(operation: XOperation, resources: number): number {
  const key = OPERATION_PRICE[operation];
  if (!key || resources <= 0) return 0;
  return Number((xPrice(key) * resources).toFixed(6));
}
