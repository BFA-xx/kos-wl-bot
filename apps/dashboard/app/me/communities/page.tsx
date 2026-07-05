import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageTitle, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Directory of every KOS community — browse and enter raffles on the web. */
export default async function CommunitiesPage() {
  const orgs = await prisma.organization.findMany({
    where: { suspendedAt: null },
    orderBy: { createdAt: "asc" },
    include: { guildConnections: { select: { guildId: true } } },
  });

  const guildIds = orgs.flatMap((o) => o.guildConnections.map((g) => g.guildId));
  const liveCounts = guildIds.length
    ? await prisma.raffle.groupBy({
        by: ["guildId"],
        where: { guildId: { in: guildIds }, status: "LIVE" },
        _count: true,
      })
    : [];
  const liveByGuild = new Map(liveCounts.map((c) => [c.guildId, c._count]));

  return (
    <>
      <PageTitle
        title="Communities"
        subtitle="Every community running raffles on KOS. Enter directly from the web."
        action={
          <Link href="/onboarding" className="kos-btn">
            Create your own
          </Link>
        }
      />

      {orgs.length === 0 ? (
        <Empty>No communities yet.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {orgs.map((o) => {
            const live = o.guildConnections.reduce(
              (sum, g) => sum + (liveByGuild.get(g.guildId) ?? 0),
              0,
            );
            return (
              <Link
                key={o.id}
                href={`/c/${o.slug}`}
                className="kos-card kos-card-hover flex items-center gap-3 p-4"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-kos-fg text-xs font-black text-kos-bg">
                  {o.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    o.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{o.name}</div>
                  <div className="truncate text-xs text-kos-muted">/{o.slug}</div>
                </div>
                {live > 0 ? (
                  <span className="kos-badge shrink-0 border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90">
                    {live} live
                  </span>
                ) : (
                  <span className="kos-badge shrink-0 border-kos-border text-kos-muted">quiet</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
