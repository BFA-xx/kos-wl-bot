import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/ui";
import { EntryPanel } from "@/components/EntryPanel";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public raffle page — details + web entry with the full gate checklist. */
export default async function PublicRafflePage({
  params,
}: {
  params: { slug: string; id: string };
}) {
  const org = await prisma.organization.findUnique({
    where: { slug: params.slug },
    include: { guildConnections: { select: { guildId: true } } },
  });
  if (!org || org.suspendedAt) notFound();

  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();
  const raffle = await prisma.raffle.findFirst({
    where: { id, guildId: { in: org.guildConnections.map((g) => g.guildId) } },
    include: {
      eligibleRoles: true,
      winners: { where: { replaced: false }, orderBy: { position: "asc" } },
    },
  });
  if (!raffle) notFound();

  const tasks =
    ((raffle.requirements as { tasks?: { label: string; url?: string }[] } | null)?.tasks) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link href={`/c/${org.slug}`} className="text-sm text-kos-muted hover:text-kos-fg">
        ← {org.name}
      </Link>

      <div className="mt-3 overflow-hidden rounded-2xl border border-kos-border">
        {raffle.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={raffle.bannerUrl} alt="" className="h-44 w-full object-cover sm:h-56" />
        ) : null}
        <div className="bg-kos-panel/50 p-5">
          <div className="flex items-center gap-2">
            <StatusBadge status={raffle.status} />
            <span className="text-xs text-kos-muted">Raffle #{raffle.id}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold uppercase tracking-tight">{raffle.projectName}</h1>
          <p className="text-kos-muted">{raffle.title}</p>
          {raffle.description ? (
            <p className="mt-3 whitespace-pre-line text-sm text-kos-muted">{raffle.description}</p>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-kos-border bg-kos-panel p-3">
              <div className="text-xl font-semibold">{raffle.spots}</div>
              <div className="text-[11px] uppercase tracking-wide text-kos-muted">WL spots</div>
            </div>
            <div className="rounded-xl border border-kos-border bg-kos-panel p-3">
              <div className="text-xl font-semibold">
                {raffle.hideEntries ? "—" : raffle.entryCount}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-kos-muted">Entries</div>
            </div>
            <div className="rounded-xl border border-kos-border bg-kos-panel p-3">
              <div className="text-sm font-semibold leading-6">{fmtDate(raffle.endAt)}</div>
              <div className="text-[11px] uppercase tracking-wide text-kos-muted">
                {raffle.status === "ENDED" ? "Ended" : "Ends"}
              </div>
            </div>
          </div>

          {tasks.length > 0 ? (
            <div className="mt-4 rounded-xl border border-kos-border bg-kos-panel p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-kos-muted">
                Steps to qualify
              </div>
              <ul className="space-y-1 text-sm">
                {tasks.map((t, i) => (
                  <li key={i}>
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noreferrer" className="text-kos-fg underline-offset-2 hover:underline">
                        {t.label} ↗
                      </a>
                    ) : (
                      <span className="text-kos-muted">• {t.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* Entry panel (client) — gates + Enter/Leave */}
      <div className="mt-4">
        <EntryPanel raffleId={raffle.id} />
      </div>

      {raffle.status === "ENDED" && raffle.winners.length > 0 ? (
        <div className="kos-card mt-4 p-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-kos-muted">
            Winners
          </div>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {raffle.winners.map((w) => (
              <li key={w.id}>
                <span className="text-kos-muted">{w.position}.</span> {w.username}
              </li>
            ))}
          </ol>
          {raffle.drawSeedHash ? (
            <p className="mt-3 text-[11px] text-kos-muted">
              Verifiable draw · commitment <code>{raffle.drawSeedHash.slice(0, 24)}…</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
