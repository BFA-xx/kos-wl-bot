import Link from "next/link";
import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, StatCard } from "@/components/ui";
import { OrgAdminActions } from "@/components/admin/OrgAdminActions";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminOrgsPage() {
  await guardAdmin();

  const [orgs, totals] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { username: true, globalName: true } },
        subscription: { select: { plan: true, status: true } },
        _count: { select: { members: true, guildConnections: true } },
      },
    }),
    Promise.all([
      prisma.organization.count(),
      prisma.guildConnection.count(),
      prisma.raffle.count(),
    ]),
  ]);
  const [orgCount, guildCount, raffleCount] = totals;

  return (
    <>
      <PageTitle title="Organizations" subtitle="Every community on the platform." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard accent label="Organizations" value={orgCount} />
        <StatCard label="Connected servers" value={guildCount} />
        <StatCard label="Total raffles" value={raffleCount} />
        <StatCard label="Members" value={orgs.reduce((a, o) => a + o._count.members, 0)} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-kos-border">
        <table className="w-full text-sm">
          <thead className="bg-kos-panel/60 text-left text-xs uppercase tracking-wide text-kos-muted">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3 text-right">Members</th>
              <th className="px-4 py-3 text-right">Servers</th>
              <th className="hidden px-4 py-3 md:table-cell">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t border-kos-border/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{o.name}</span>
                    {o.suspendedAt ? (
                      <span className="kos-badge border-amber-400/30 text-amber-400">paused</span>
                    ) : null}
                  </div>
                  <Link href={`/${o.slug}/dashboard`} className="text-xs text-kos-muted hover:text-kos-fg">
                    /{o.slug}
                  </Link>
                </td>
                <td className="px-4 py-3 text-kos-muted">{o.owner.globalName ?? o.owner.username}</td>
                <td className="px-4 py-3">
                  <span className="kos-badge border-kos-border text-kos-muted">
                    {o.subscription?.plan ?? "FREE"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{o._count.members}</td>
                <td className="px-4 py-3 text-right">{o._count.guildConnections}</td>
                <td className="hidden px-4 py-3 text-kos-muted md:table-cell">{fmtDate(o.createdAt)}</td>
                <td className="px-4 py-3">
                  <OrgAdminActions id={o.id} name={o.name} suspended={Boolean(o.suspendedAt)} />
                </td>
              </tr>
            ))}
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-kos-muted">
                  No organizations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
