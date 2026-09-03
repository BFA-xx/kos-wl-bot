import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import {
  xCostOverview,
  xRaffleCosts,
  xSweepConfigured,
  xVerifyConfigured,
  xVerifyMode,
} from "@kos/db";
import { PageTitle, StatCard, Card, SectionTitle, TableShell, Empty } from "@/components/ui";
import { CostSimulator } from "@/components/admin/CostSimulator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const OPERATION_LABELS: Record<string, string> = {
  follow_check: "Follow verification",
  engager_sweep_page: "Like / repost sweeps",
  post_metrics: "Post metrics (sweep sizing)",
  token_refresh: "OAuth token refresh",
};

export default async function AdminXCostsPage() {
  await guardAdmin();

  const [overview, raffles] = await Promise.all([
    xCostOverview(prisma),
    xRaffleCosts(prisma),
  ]);

  const mode = xVerifyMode();
  const scope = xSweepConfigured()
    ? "follows + likes/reposts"
    : xVerifyConfigured()
      ? "follows only"
      : "disabled";

  return (
    <>
      <PageTitle
        title="X API Costs"
        subtitle="Estimated spend on X task verification. Figures are derived from our own call log — X publishes no balance endpoint."
      />

      {/* The single most important caveat on this page. */}
      <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300/90">
        <strong className="font-semibold">Estimated API Cost.</strong> Every dollar
        figure here is calculated from our own request log multiplied by the rate
        table, not read from X. X exposes no credit-balance API, so this page can
        never show your real balance. Treat the{" "}
        <span className="font-medium">Developer Console</span> as the authority on
        money actually spent — and if the two drift apart, correct the rates with
        the <code className="font-mono">X_PRICE_*</code> environment variables.
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Mode" value={mode} />
        <StatCard label="Verifying" value={scope} />
        <StatCard accent label="Est. spent (all time)" value={usd(overview.allTime.estimatedCostUsd)} />
        <StatCard label="Requests today" value={overview.today.requests} />
        <StatCard label="Requests this week" value={overview.week.requests} />
        <StatCard label="Est. per entrant" value={usd(overview.estimatedCostPerUserUsd)} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Budget ceiling</SectionTitle>
          <dl className="space-y-2 text-sm">
            <Row label={`Reads claimed (${overview.budget.month})`}>
              {overview.budget.reads} / {overview.budget.budget || "unset"}
            </Row>
            <Row label="Remaining">{overview.budget.remaining}</Row>
            <Row label="Ceiling value">{usd(overview.budget.spentUsd)}</Row>
          </dl>
          <p className="mt-3 text-xs text-kos-muted">
            The ceiling counts <em>requests claimed</em>, not resources billed. It
            deliberately over-counts — rate-limited and failed calls are refunded,
            but X&rsquo;s 24-hour deduplication is not modelled — so real spend
            lands at or below this figure. Use the log-derived totals above for
            what was actually consumed.
          </p>
        </Card>

        <Card>
          <SectionTitle>Caching</SectionTitle>
          <dl className="space-y-2 text-sm">
            <Row label="Real API requests">{overview.allTime.requests}</Row>
            <Row label="Served from cache">{overview.allTime.cachedRequests}</Row>
            <Row label="Cache hit rate">{pct(overview.allTime.cacheHitRate)}</Row>
            <Row label="Est. cost without caching">
              {usd(overview.allTime.estimatedCostWithoutCacheUsd)}
            </Row>
            <Row label="Est. saved by caching">
              <span className="text-emerald-400">
                {usd(overview.allTime.estimatedSavingsUsd)}
              </span>
            </Row>
          </dl>
        </Card>
      </div>

      <Card className="mb-5">
        <SectionTitle>Cost by verification type</SectionTitle>
        {overview.byOperation.length === 0 ? (
          <Empty>No X API calls recorded yet.</Empty>
        ) : (
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-kos-muted">
                  <th className="py-2">Operation</th>
                  <th className="py-2 text-right">API calls</th>
                  <th className="py-2 text-right">Cached</th>
                  <th className="py-2 text-right">Resources</th>
                  <th className="py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {overview.byOperation.map((op) => (
                  <tr key={op.operation} className="border-t border-kos-border">
                    <td className="py-2">{OPERATION_LABELS[op.operation] ?? op.operation}</td>
                    <td className="py-2 text-right tabular-nums">{op.requests}</td>
                    <td className="py-2 text-right tabular-nums text-kos-muted">
                      {op.cachedRequests}
                    </td>
                    <td className="py-2 text-right tabular-nums">{op.resources}</td>
                    <td className="py-2 text-right tabular-nums">{usd(op.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
        <p className="mt-3 text-xs text-kos-muted">
          Quote and comment tasks do not appear here: replies need the search
          endpoints and quote posts are not returned by the repost list, so both
          stay on link + attest and cost nothing.
        </p>
      </Card>

      <Card className="mb-5">
        <SectionTitle>Per raffle</SectionTitle>
        {raffles.length === 0 ? (
          <Empty>No raffle-attributed X spend yet.</Empty>
        ) : (
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-kos-muted">
                  <th className="py-2">Raffle</th>
                  <th className="py-2 text-right">Entrants</th>
                  <th className="py-2 text-right">API calls</th>
                  <th className="py-2 text-right">Cached</th>
                  <th className="py-2 text-right">Est. cost</th>
                  <th className="py-2 text-right">Per entrant</th>
                </tr>
              </thead>
              <tbody>
                {raffles.map((r) => (
                  <tr key={r.raffleId} className="border-t border-kos-border">
                    <td className="py-2">{r.title}</td>
                    <td className="py-2 text-right tabular-nums">{r.entrants}</td>
                    <td className="py-2 text-right tabular-nums">{r.requests}</td>
                    <td className="py-2 text-right tabular-nums text-kos-muted">
                      {r.cachedRequests}
                    </td>
                    <td className="py-2 text-right tabular-nums">{usd(r.estimatedCostUsd)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {usd(r.estimatedCostPerEntrantUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
        <p className="mt-3 text-xs text-kos-muted">
          A task shared by several raffles is counted under each of them, because
          each genuinely benefited from the same paid lookup. Totals here can
          therefore exceed all-time spend.
        </p>
      </Card>

      <CostSimulator pricing={overview.pricing} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-kos-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
