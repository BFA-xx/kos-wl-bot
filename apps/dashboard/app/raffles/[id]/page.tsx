import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { PageTitle, StatusBadge, StatCard } from "@/components/ui";
import { RaffleActions } from "@/components/RaffleActions";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RaffleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const raffle = await prisma.raffle.findUnique({
    where: { id },
    include: {
      eligibleRoles: true,
      winners: { where: { replaced: false }, orderBy: { position: "asc" }, include: { wallet: true } },
      proof: true,
      _count: { select: { participants: true } },
    },
  });
  if (!raffle) notFound();

  const req = (raffle.requirements ?? {}) as Record<string, unknown>;

  return (
    <Shell>
      <div className="mb-2">
        <Link href="/raffles" className="text-sm text-kos-grey hover:text-kos-white">
          ← All raffles
        </Link>
      </div>
      <PageTitle
        title={raffle.title}
        subtitle={`${raffle.projectName} · Raffle #${raffle.id}`}
        action={<StatusBadge status={raffle.status} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="WL Spots" value={raffle.spots} />
        <StatCard label="Entries" value={raffle._count.participants} />
        <StatCard label="Winners" value={raffle.winners.length} />
        <StatCard
          label="Role Mode"
          value={<span className="text-base">{raffle.roleMatchMode}</span>}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-grey">
            Details
          </h3>
          <dl className="space-y-2 text-sm">
            <Row label="Start" value={fmtDate(raffle.startAt)} />
            <Row label="End" value={fmtDate(raffle.endAt)} />
            <Row label="Drawn" value={fmtDate(raffle.drawnAt)} />
            <Row
              label="Eligible Roles"
              value={
                raffle.eligibleRoles.length
                  ? raffle.eligibleRoles.map((r) => r.roleName).join(", ")
                  : "Everyone"
              }
            />
            <Row label="Collect Wallets" value={raffle.collectWallets ? "Yes" : "No"} />
            <Row label="Wallet Chains" value={raffle.walletChains.join(", ") || "—"} />
            {raffle.drawSeedHash ? (
              <Row label="Draw Commitment" value={<code className="text-xs">{raffle.drawSeedHash.slice(0, 28)}…</code>} />
            ) : null}
          </dl>

          {Object.keys(req).length > 0 ? (
            <div className="mt-4 border-t border-kos-line pt-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-kos-grey">
                Anti-alt Requirements
              </div>
              <pre className="overflow-x-auto rounded-lg bg-kos-panel p-3 text-xs text-kos-silver">
                {JSON.stringify(req, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-grey">
            Winners
          </h3>
          {raffle.winners.length === 0 ? (
            <p className="text-sm text-kos-grey">No winners drawn yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {raffle.winners.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span>
                    <span className="text-kos-grey">{w.position}.</span> {w.username}
                    {w.fromReroll ? <span className="ml-2 text-xs text-kos-grey">(reroll)</span> : null}
                  </span>
                  <span className="text-xs text-kos-grey">
                    {w.wallet ? `${w.wallet.chain} ✓` : "no wallet"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-4">
        <RaffleActions raffleId={raffle.id} status={raffle.status} />
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-kos-grey">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
