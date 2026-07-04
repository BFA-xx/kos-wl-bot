import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { PageTitle, StatusBadge, StatCard } from "@/components/ui";
import { RaffleActions } from "@/components/RaffleActions";
import { RaffleEditButton } from "@/components/RaffleEditButton";
import { ParticipantsLive } from "@/components/ParticipantsLive";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RaffleDetailPage({
  params,
}: {
  params: { org: string; id: string };
}) {
  let guildIds: string[];
  try {
    ({ guildIds } = await requireOrgAccess(params.org));
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) redirect("/login");
      redirect("/");
    }
    throw err;
  }

  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const raffle = await prisma.raffle.findFirst({
    where: { id, guildId: { in: guildIds } },
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
    <>
      <div className="mb-2">
        <Link href={`/${params.org}/raffles`} className="text-sm text-kos-muted hover:text-kos-fg">
          ← All raffles
        </Link>
      </div>
      <PageTitle
        title={raffle.title}
        subtitle={`${raffle.projectName} · Raffle #${raffle.id}`}
        action={
          <div className="flex items-center gap-2">
            <RaffleEditButton
              raffle={{
                id: raffle.id,
                guildId: raffle.guildId,
                status: raffle.status,
                projectName: raffle.projectName,
                title: raffle.title,
                description: raffle.description,
                spots: raffle.spots,
                startAt: raffle.startAt.toISOString(),
                endAt: raffle.endAt.toISOString(),
                bannerUrl: raffle.bannerUrl,
                hideEntries: raffle.hideEntries,
                requireWallet: raffle.requireWallet,
                startPing: raffle.startPing,
                roleMatchMode: raffle.roleMatchMode,
                walletChains: raffle.walletChains,
                collectWallets: raffle.collectWallets,
                announceChannelId: raffle.announceChannelId,
                proofChannelId: raffle.proofChannelId,
                tasks:
                  ((raffle.requirements as { tasks?: { label: string; url?: string }[] } | null)?.tasks) ?? [],
                roles: raffle.eligibleRoles.map((r) => ({ roleId: r.roleId, roleName: r.roleName })),
              }}
            />
            <StatusBadge status={raffle.status} />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="WL Spots" value={raffle.spots} />
        <StatCard label="Entries" value={raffle._count.participants} />
        <StatCard label="Winners" value={raffle.winners.length} />
        <StatCard label="Role Mode" value={<span className="text-base">{raffle.roleMatchMode}</span>} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">Details</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Start" value={fmtDate(raffle.startAt)} />
            <Row label="End" value={fmtDate(raffle.endAt)} />
            <Row label="Drawn" value={fmtDate(raffle.drawnAt)} />
            <Row
              label="Eligible Roles"
              value={raffle.eligibleRoles.length ? raffle.eligibleRoles.map((r) => r.roleName).join(", ") : "Everyone"}
            />
            <Row label="Collect Wallets" value={raffle.collectWallets ? "Yes" : "No"} />
            <Row label="Wallet Chains" value={raffle.walletChains.join(", ") || "—"} />
            {raffle.drawSeedHash ? (
              <Row label="Draw Commitment" value={<code className="text-xs">{raffle.drawSeedHash.slice(0, 28)}…</code>} />
            ) : null}
          </dl>

          {Object.keys(req).length > 0 ? (
            <div className="mt-4 border-t border-kos-border pt-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-kos-muted">Anti-alt Requirements</div>
              <pre className="overflow-x-auto rounded-lg bg-kos-panel p-3 text-xs text-kos-muted">
                {JSON.stringify(req, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">Winners</h3>
          {raffle.winners.length === 0 ? (
            <p className="text-sm text-kos-muted">No winners drawn yet.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {raffle.winners.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span>
                    <span className="text-kos-muted">{w.position}.</span> {w.username}
                    {w.fromReroll ? <span className="ml-2 text-xs text-kos-muted">(reroll)</span> : null}
                  </span>
                  <span className="text-xs text-kos-muted">{w.wallet ? `${w.wallet.chain} ✓` : "no wallet"}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-4">
        <ParticipantsLive raffleId={raffle.id} />
      </div>

      <div className="mt-4">
        <RaffleActions raffleId={raffle.id} status={raffle.status} />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-kos-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
