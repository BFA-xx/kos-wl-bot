import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public community page — any signed-in KOS member can browse a community and
 * its raffles here, no org membership required. Entry happens on the raffle
 * page with full gate checks.
 */
export default async function CommunityPage({ params }: { params: { slug: string } }) {
  const org = await prisma.organization.findUnique({
    where: { slug: params.slug },
    include: { guildConnections: { select: { guildId: true } } },
  });
  if (!org || org.suspendedAt) notFound();

  const guildIds = org.guildConnections.map((g) => g.guildId);
  const [live, ended] = await Promise.all([
    prisma.raffle.findMany({
      where: { guildId: { in: guildIds }, status: { in: ["LIVE", "UPCOMING"] } },
      orderBy: { endAt: "asc" },
      take: 24,
    }),
    prisma.raffle.findMany({
      where: { guildId: { in: guildIds }, status: "ENDED" },
      orderBy: { endedAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Branded header */}
      <div className="overflow-hidden rounded-2xl border border-kos-border">
        {org.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.bannerUrl} alt="" className="h-36 w-full object-cover sm:h-48" />
        ) : (
          <div className="h-24 w-full bg-gradient-to-r from-kos-panel to-kos-bg" />
        )}
        <div className="flex items-center gap-4 bg-kos-panel/50 p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-kos-fg text-sm font-black text-kos-bg">
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              org.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{org.name}</h1>
            {org.description ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-kos-muted">{org.description}</p>
            ) : (
              <p className="text-sm text-kos-muted">Whitelist raffles · Powered by KOS</p>
            )}
          </div>
          <Link href="/me/communities" className="kos-btn ml-auto hidden shrink-0 sm:block">
            All communities
          </Link>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-kos-muted">
        Live &amp; upcoming
      </h2>
      {live.length === 0 ? (
        <Empty>No live raffles right now — check back soon.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((r) => (
            <Link
              key={r.id}
              href={`/c/${org.slug}/raffles/${r.id}`}
              className="kos-card kos-card-hover overflow-hidden"
            >
              {r.bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.bannerUrl} alt="" className="h-28 w-full object-cover" />
              ) : null}
              <div className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-kos-muted">#{r.id}</span>
                  </div>
                  <div className="mt-1 truncate font-medium">{r.projectName}</div>
                  <div className="truncate text-sm text-kos-muted">{r.title}</div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-lg font-semibold">{r.spots}</div>
                  <div className="text-xs text-kos-muted">spots · ends {fmtDate(r.endAt)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {ended.length > 0 ? (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-kos-muted">
            Recently ended
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {ended.map((r) => (
              <Link
                key={r.id}
                href={`/c/${org.slug}/raffles/${r.id}`}
                className="kos-card kos-card-hover flex items-center justify-between p-4 opacity-80"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.projectName}</div>
                  <div className="truncate text-sm text-kos-muted">{r.title}</div>
                </div>
                <StatusBadge status="ENDED" />
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <p className="mt-10 text-center text-xs text-kos-muted">
        {org.name} · Powered by KOS
      </p>
    </div>
  );
}
