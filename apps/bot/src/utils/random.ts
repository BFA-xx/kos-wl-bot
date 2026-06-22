import { randomInt, randomBytes, createHash, createHmac } from "node:crypto";

/**
 * Cryptographically secure, unbiased integer in [0, maxExclusive).
 * Uses Node's `crypto.randomInt`, which performs rejection sampling.
 */
export function secureInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new RangeError("maxExclusive must be > 0");
  return randomInt(0, maxExclusive);
}

/** In-place cryptographically secure Fisher–Yates shuffle. */
export function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * Select `count` unique winners from `pool` using a secure shuffle.
 * Returns at most `pool.length` items (never duplicates).
 */
export function secureSample<T>(pool: readonly T[], count: number): T[] {
  const copy = [...pool];
  secureShuffle(copy);
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
}

/**
 * Generate a verifiable draw seed: a random 32-byte hex string plus its
 * SHA-256 commitment. The commitment can be published before the draw and the
 * seed afterwards, letting anyone verify the result was not manipulated.
 */
export function generateDrawSeed(): { seed: string; hash: string } {
  const seed = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(seed).digest("hex");
  return { seed, hash };
}

/**
 * Deterministic, verifiable winner selection.
 *
 * Each candidate is assigned a sort key = HMAC-SHA256(seed, id). Sorting by
 * key and taking the first `count` yields a uniformly random selection that
 * anyone can reproduce given the (later-revealed) seed and the participant
 * list — proving the draw was not rigged. The seed is cryptographically
 * random, so the ordering is unpredictable until revealed.
 */
export function verifiableSample<T>(
  pool: readonly T[],
  count: number,
  seed: string,
  idOf: (item: T) => string,
): T[] {
  const ranked = pool.map((item) => ({
    item,
    key: createHmac("sha256", seed).update(idOf(item)).digest("hex"),
  }));
  ranked.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ranked.slice(0, Math.max(0, Math.min(count, ranked.length))).map((r) => r.item);
}

/** Verify that a revealed seed matches its published commitment hash. */
export function verifyDrawSeed(seed: string, hash: string): boolean {
  return createHash("sha256").update(seed).digest("hex") === hash;
}
