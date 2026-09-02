import { prisma } from "@/lib/db";

/**
 * Records that somebody is actually using the dashboard, so the bot knows how
 * fast to sweep.
 *
 * The bot sleeps between ticks so the Postgres compute can suspend, and that
 * idle time is essentially the whole database bill. Sleeping is only painful
 * for dashboard-written requests (publish/reroll/edit/delete), which have no
 * push channel to the bot and would otherwise wait out the full idle cap.
 *
 * The way out is that those requests only ever happen while someone has the
 * dashboard open — and an open dashboard is already polling with SWR every few
 * seconds, so the compute is awake regardless. Sweeping quickly during that
 * window therefore costs nothing extra. This marker is how the bot tells the
 * two situations apart.
 */
export const DASHBOARD_PRESENCE_KEY = "dashboard-active";

/**
 * One write per instance per window. Several open tabs polling on 4s timers
 * would otherwise stamp this many times a second for no added signal.
 */
const WRITE_EVERY_MS = 30_000;
let lastWrite = 0;

/** Fire-and-forget: presence is an optimisation, never a reason to fail. */
export function markDashboardActive(): void {
  const now = Date.now();
  if (now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;

  const value = new Date(now).toISOString();
  void prisma.systemStatus
    .upsert({
      where: { key: DASHBOARD_PRESENCE_KEY },
      create: { key: DASHBOARD_PRESENCE_KEY, value },
      update: { value },
    })
    .catch(() => {
      // Let the next request try again rather than going quiet for a window.
      lastWrite = 0;
    });
}
