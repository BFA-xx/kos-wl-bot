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
export default async function CommunityPage({
  params,
}: {
  params: { slug: string };
}) {
  const org = await prisma.organization.findUnique({
    where: { slug: params.slug },
    include: { guildConnections: { select: { guildId: true } } },
  });
  if (!org || org.suspendedAt) notFound();

  const guildIds = org.guildConnections.map((g) => g.guildId);
  const [live, ended] = await Promise.all([
    prisma.raffle.findMany({
      where: {
        guildId: { in: guildIds },
        status: { in: ["LIVE", "UPCOMING"] },
      },
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
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
      {/* Branded header */}
      <div className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
        {org.bannerUrl ? (
          <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.18),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-3 sm:p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={org.bannerUrl}
              alt=""
              className="mx-auto block max-h-[360px] w-auto max-w-full rounded-3xl object-contain shadow-2xl shadow-black/30"
            />
          </div>
        ) : (
          <div className="h-32 w-full bg-gradient-to-br from-blue-500/12 via-violet-500/10 to-transparent" />
        )}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-kos-fg text-sm font-black text-kos-bg">
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={org.logoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              org.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300/90">
              KOS community
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {org.name}
            </h1>
            {org.description ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-kos-muted">
                {org.description}
              </p>
            ) : (
              <p className="text-sm text-kos-muted">
                Whitelist raffles · Powered by KOS
              </p>
            )}
          </div>
          <Link href="/me/communities" className="kos-btn shrink-0 sm:ml-auto">
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
        <div className="grid gap-4 sm:grid-cols-2">
          {live.map((r) => (
            <Link
              key={r.id}
              href={`/r/${r.id}`}
              className="kos-card kos-card-hover overflow-hidden"
            >
              {r.bannerUrl ? (
                <div className="border-b border-white/[0.08] bg-white/[0.025] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.bannerUrl}
                    alt=""
                    className="mx-auto block max-h-44 w-auto max-w-full rounded-2xl object-contain"
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-kos-muted">#{r.id}</span>
                  </div>
                  <div className="mt-1 truncate font-medium">
                    {r.projectName}
                  </div>
                  <div className="truncate text-sm text-kos-muted">
                    {r.title}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold">{r.spots}</div>
                  <div className="text-xs text-kos-muted">
                    spots · ends {fmtDate(r.endAt)}
                  </div>
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
                href={`/r/${r.id}`}
                className="kos-card kos-card-hover flex items-center justify-between p-4 opacity-80"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.projectName}</div>
                  <div className="truncate text-sm text-kos-muted">
                    {r.title}
                  </div>
                </div>
                <StatusBadge status="ENDED" />
              </Link>
            ))}
          </div>
        </>
      ) : null}

    </div>
  );
}
