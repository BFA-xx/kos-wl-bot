import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, StatCard, Card, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Placeholder pricing until real billing lands.
const PRICE: Record<string, number> = { FREE: 0, PRO: 49, SCALE: 199 };

export default async function AdminRevenuePage() {
  await guardAdmin();

  const grouped = await prisma.subscription.groupBy({
    by: ["plan", "status"],
    _count: true,
  });

  const byPlan: Record<string, number> = { FREE: 0, PRO: 0, SCALE: 0 };
  let mrr = 0;
  for (const g of grouped) {
    byPlan[g.plan] = (byPlan[g.plan] ?? 0) + g._count;
    if (g.status === "ACTIVE") mrr += (PRICE[g.plan] ?? 0) * g._count;
  }

  return (
    <>
      <PageTitle title="Revenue" subtitle="Subscription overview (placeholder pricing)." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard accent label="Est. MRR" value={`$${mrr.toLocaleString()}`} hint="active subscriptions" />
        <StatCard label="Free" value={byPlan.FREE} />
        <StatCard label="Pro" value={byPlan.PRO} />
        <StatCard label="Scale" value={byPlan.SCALE} />
      </div>

      <Card>
        <SectionTitle>Plans</SectionTitle>
        <div className="space-y-2 text-sm">
          {Object.entries(PRICE).map(([plan, price]) => (
            <div key={plan} className="flex items-center justify-between rounded-xl border border-kos-border bg-kos-panel/50 px-4 py-3">
              <span className="font-medium">{plan}</span>
              <span className="text-kos-muted">
                {byPlan[plan] ?? 0} orgs · ${price}/mo
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-kos-muted">
          Real billing (Stripe) isn't wired yet — figures use placeholder pricing.
        </p>
      </Card>
    </>
  );
}
