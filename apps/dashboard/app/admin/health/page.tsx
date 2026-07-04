import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, StatCard, Card, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminHealthPage() {
  await guardAdmin();

  const [orgs, guilds, raffles, live, participants, wallets] = await Promise.all([
    prisma.organization.count(),
    prisma.guildConnection.count(),
    prisma.raffle.count(),
    prisma.raffle.count({ where: { status: "LIVE" } }),
    prisma.participant.count(),
    prisma.walletProfile.count(),
  ]);

  const botConfigured = Boolean(process.env.INTERNAL_API_TOKEN);

  return (
    <>
      <PageTitle title="Server Health" subtitle="Platform metrics at a glance." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Organizations" value={orgs} />
        <StatCard label="Servers" value={guilds} />
        <StatCard label="Raffles" value={raffles} />
        <StatCard accent label="Live now" value={live} />
        <StatCard label="Entries" value={participants} />
        <StatCard label="Wallets" value={wallets} />
      </div>

      <Card>
        <SectionTitle>Services</SectionTitle>
        <div className="space-y-2 text-sm">
          <Service name="Database" ok label="connected" />
          <Service
            name="Bot control API"
            ok={botConfigured}
            label={botConfigured ? "configured" : "not configured"}
          />
        </div>
        <p className="mt-4 text-xs text-kos-muted">
          The bot's internal control API is reachable only when the dashboard and
          bot are co-located (or bridged over a private network).
        </p>
      </Card>
    </>
  );
}

function Service({ name, ok, label }: { name: string; ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-kos-border bg-kos-panel/50 px-4 py-3">
      <span className="font-medium">{name}</span>
      <span className="flex items-center gap-2 text-kos-muted">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
        {label}
      </span>
    </div>
  );
}
