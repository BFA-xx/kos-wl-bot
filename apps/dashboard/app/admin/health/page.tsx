import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import {
  xBudgetSnapshot,
  xSweepConfigured,
  xVerifyConfigured,
  xVerifyMode,
} from "@kos/db";
import { PageTitle, StatCard, Card, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminHealthPage() {
  await guardAdmin();

  const [orgs, guilds, raffles, live, participants, wallets] =
    await Promise.all([
      prisma.organization.count(),
      prisma.guildConnection.count(),
      prisma.raffle.count(),
      prisma.raffle.count({ where: { status: "LIVE" } }),
      prisma.participant.count(),
      prisma.walletProfile.count(),
    ]);

  const hb = await prisma.systemStatus.findUnique({
    where: { key: "bot-heartbeat" },
  });
  const hbInfo = (() => {
    try {
      return hb?.value
        ? (JSON.parse(hb.value) as {
            guilds?: number;
            user?: string;
            scheduler?: { nextTickAt?: string | null };
          })
        : null;
    } catch {
      return null;
    }
  })();

  // The bot sleeps between ticks so the database compute can suspend, so a
  // quiet heartbeat is normal rather than a fault. It publishes the deadline
  // it intends to write by, so trust that (plus grace) instead of a fixed
  // window. Older bot builds don't send it — fall back to the ~60s cadence.
  const GRACE_MS = 3 * 60_000;
  const nextTickAt = hbInfo?.scheduler?.nextTickAt
    ? Date.parse(hbInfo.scheduler.nextTickAt)
    : NaN;
  const dueBy = Number.isNaN(nextTickAt)
    ? (hb?.updatedAt.getTime() ?? 0) + 60_000
    : nextTickAt;
  const botOnline = Boolean(hb && Date.now() < dueBy + GRACE_MS);
  const botLabel = botOnline
    ? `online${hbInfo?.guilds != null ? ` · ${hbInfo.guilds} servers` : ""}`
    : hb
      ? `offline — last seen ${hb.updatedAt.toLocaleString()}`
      : "waiting for first heartbeat";

  // X follow checks cost real money per member, so the ceiling has to be
  // visible here — otherwise it trips silently and follows quietly drop back
  // to attest with nobody the wiser.
  const xBudget = await xBudgetSnapshot(prisma);
  const xOn = xVerifyConfigured();
  const xScope = xSweepConfigured()
    ? "follows + likes/reposts"
    : xVerifyMode() === "full"
      ? "follows only — sweeps need X_BEARER_TOKEN"
      : "follows only";
  const xLabel = xOn
    ? `${xScope} · ${xBudget.reads}/${xBudget.budget} reads used (≤ $${xBudget.spentUsd.toFixed(2)})`
    : xVerifyMode() === "off"
      ? "off — X tasks are link + attest"
      : "not configured — set credentials and a read budget";

  return (
    <>
      <PageTitle
        title="Server Health"
        subtitle="Platform metrics at a glance."
      />

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
          <Service
            name="X task verification"
            ok={xOn && xBudget.remaining > 0}
            label={xLabel}
          />
        </div>
        {xOn && xBudget.remaining === 0 && (
          <p className="mt-3 text-xs text-amber-400">
            This month&rsquo;s X read budget is spent. Follow, like and repost
            tasks are falling back to link + attest until {xBudget.month} rolls
            over, or until X_VERIFY_MONTHLY_READ_BUDGET is raised.
          </p>
        )}
        <p className="mt-4 text-xs text-kos-muted">
          Dashboard commands (post, edit, end, reroll) are delivered to the bot
          through the database — no direct network link is needed. The bot
          reports a heartbeat every minute.
        </p>
      </Card>
    </>
  );
}

function Service({
  name,
  ok,
  label,
}: {
  name: string;
  ok: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kos-border bg-kos-panel/50 px-4 py-3">
      <span className="font-medium">{name}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-kos-muted">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`}
        />
        {label}
      </span>
    </div>
  );
}
