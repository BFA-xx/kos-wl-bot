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

  // The bot writes a heartbeat row every ~60s; treat it as online if we've
  // heard from it in the last 3 minutes.
  const hb = await prisma.systemStatus.findUnique({ where: { key: "bot-heartbeat" } });
  const botOnline = Boolean(hb && Date.now() - hb.updatedAt.getTime() < 3 * 60_000);
  const hbInfo = (() => {
    try {
      return hb?.value ? (JSON.parse(hb.value) as { guilds?: number; user?: string }) : null;
    } catch {
      return null;
    }
  })();
  const botLabel = botOnline
    ? `online${hbInfo?.guilds != null ? ` · ${hbInfo.guilds} servers` : ""}`
    : hb
      ? `offline — last seen ${hb.updatedAt.toLocaleString()}`
      : "waiting for first heartbeat";

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
          <Service name="Discord bot" ok={botOnline} label={botLabel} />
        </div>
        <p className="mt-4 text-xs text-kos-muted">
          Dashboard commands (post, edit, end, reroll) are delivered to the bot
          through the database — no direct network link is needed. The bot
          reports a heartbeat every minute.
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
