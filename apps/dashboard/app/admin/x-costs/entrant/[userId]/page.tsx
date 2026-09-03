import Link from "next/link";
import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { xEntrantTrace } from "@kos/db";
import { PageTitle, Card, SectionTitle, Empty, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Verification debug view: for one entrant, exactly what each task cost and
 * whether the answer came from cache or from X. This is the view to open when
 * credits are draining faster than expected.
 */
export default async function EntrantDebugPage({
  params,
}: {
  params: { userId: string };
}) {
  await guardAdmin();

  const [user, trace, xAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.userId } }),
    xEntrantTrace(prisma, params.userId),
    prisma.connectedAccount.findUnique({
      where: { userId_provider: { userId: params.userId, provider: "X" } },
      select: { handle: true, externalId: true },
    }),
  ]);

  const totalCost = trace.reduce((sum, t) => sum + t.estimatedCostUsd, 0);
  const apiCalls = trace.reduce((sum, t) => sum + t.apiCalls, 0);
  const cachedCalls = trace.reduce((sum, t) => sum + t.cachedCalls, 0);
  const usd = (n: number) => `$${n.toFixed(4)}`;

  return (
    <>
      <PageTitle
        title={xAccount?.handle ? `@${xAccount.handle}` : (user?.username ?? params.userId)}
        subtitle="Per-entrant verification trace — estimated cost and cache source per task."
      />

      <div className="mb-4">
        <Link href="/admin/x-costs" className="text-xs text-kos-muted hover:text-white">
          ← Back to X API Costs
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="X account" value={xAccount?.handle ? `@${xAccount.handle}` : "not linked"} />
        <StatCard accent label="Est. cost" value={usd(totalCost)} />
        <StatCard label="API calls" value={apiCalls} />
        <StatCard label="Served from cache" value={cachedCalls} />
      </div>

      <Card>
        <SectionTitle>Tasks</SectionTitle>
        {trace.length === 0 ? (
          <Empty>No verification activity recorded for this user.</Empty>
        ) : (
          <ul className="space-y-3">
            {trace.map((t) => (
              <li
                key={t.taskId}
                className="rounded-xl border border-kos-border bg-kos-panel/50 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t.status === "VERIFIED" ? "✓" : "•"} {t.taskTitle}
                  </span>
                  <span className="text-xs text-kos-muted">{t.taskType}</span>
                </div>
                <dl className="grid gap-1 text-xs text-kos-muted sm:grid-cols-2">
                  <Line label="Status">{t.status ?? "not attempted"}</Line>
                  <Line label="Verification source">
                    {t.source === "api" ? "X API" : t.source === "cache" ? "cache" : "—"}
                  </Line>
                  <Line label="API calls used">{t.apiCalls}</Line>
                  <Line label="Cache hits">{t.cachedCalls}</Line>
                  <Line label="Estimated cost">{usd(t.estimatedCostUsd)}</Line>
                  <Line label="Last checked">
                    {t.lastCheckedAt ? t.lastCheckedAt.toLocaleString() : "—"}
                  </Line>
                  {t.evidenceMethod && <Line label="Method">{t.evidenceMethod}</Line>}
                </dl>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-kos-muted">
          A task showing cache hits and no API calls was answered without spending
          anything — that is the cooldown and sweep cache doing their job. Repeated
          API calls on one task point at a member retrying a check they keep
          failing.
        </p>
      </Card>
    </>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 sm:justify-start sm:gap-1">
      <dt>{label}:</dt>
      <dd className="font-medium text-white/80">{children}</dd>
    </div>
  );
}
