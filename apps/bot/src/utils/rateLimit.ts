/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Used to throttle button spam (Enter/Leave) per user. For a multi-process
 * deployment this would move to Redis, but a single bot process is the common
 * case and this keeps hot-path checks allocation-cheap.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the action is allowed, false if the key is over budget. */
  take(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  /** Periodic cleanup to bound memory; safe to call on an interval. */
  sweep(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, arr] of this.hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}
