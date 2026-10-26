/**
 * Seconds Prisma waits to open a connection. Prisma's default is 5, but the
 * bot disconnects whenever it sleeps so the Neon compute can suspend, which
 * makes every wake a cold start that can take longer than that. A timed-out
 * connect mid-tick fails every query after it — the shape of the missed
 * raffle #271 start ping.
 */
export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;

/**
 * Add a connect_timeout to a Postgres URL unless one is already set, so an
 * explicit value in an environment's DATABASE_URL still wins.
 */
export function withConnectTimeout(
  rawUrl: string | undefined,
  seconds = DEFAULT_CONNECT_TIMEOUT_SECONDS,
): string | undefined {
  if (!rawUrl) return rawUrl;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.searchParams.has("connect_timeout")) return rawUrl;
  url.searchParams.set("connect_timeout", String(seconds));
  return url.toString();
}
