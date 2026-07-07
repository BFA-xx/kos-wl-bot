import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, SectionTitle, StatusBadge } from "@/components/ui";
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
    (
      raffle.requirements as {
        tasks?: { label: string; url?: string }[];
      } | null
    )?.tasks ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <Link
        href={`/c/${org.slug}`}
        className="text-sm text-kos-muted transition-colors hover:text-kos-fg"
      >
        ← {org.name}
      </Link>

      <div className="mt-4 overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
        {raffle.bannerUrl ? (
          <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.18),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-3 sm:p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={raffle.bannerUrl}
              alt=""
              className="mx-auto block max-h-[420px] w-auto max-w-full rounded-3xl object-contain shadow-2xl shadow-black/30"
            />
          </div>
        ) : null}
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={raffle.status} />
            <span className="kos-badge border-white/[0.08] text-kos-muted">
              Raffle #{raffle.id}
            </span>
            {raffle.useRoleWeights ? (
              <span className="kos-badge border-blue-400/25 text-blue-300">
                weighted draw
              </span>
            ) : null}
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                {raffle.projectName}
              </h1>
              <p className="mt-2 text-base text-kos-muted sm:text-lg">
                {raffle.title}
              </p>
              {raffle.description ? (
                <p className="mt-5 max-w-2xl whitespace-pre-line text-sm leading-6 text-kos-muted">
                  {raffle.description}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
              <MiniStat label="WL spots" value={raffle.spots} />
              <MiniStat
                label="Entries"
                value={raffle.hideEntries ? "—" : raffle.entryCount}
              />
              <MiniStat
                label={raffle.status === "ENDED" ? "Ended" : "Ends"}
                value={fmtDate(raffle.endAt)}
              />
            </div>
          </div>

          {tasks.length > 0 ? (
            <Card className="mt-6">
              <SectionTitle>Steps to qualify</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                {tasks.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-sm font-semibold text-blue-300">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t.label}
                      </div>
                      <div className="text-xs text-kos-muted">
                        Complete this before entering
                      </div>
                    </div>
                    {t.url ? (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="kos-btn px-3 py-1.5 text-xs"
                      >
                        Open ↗
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Entry panel (client) — gates + Enter/Leave */}
      <div className="mt-4">
        <EntryPanel raffleId={raffle.id} />
      </div>

      {raffle.status === "ENDED" && raffle.winners.length > 0 ? (
        <div className="kos-card mt-4 p-5">
          <SectionTitle>Winners</SectionTitle>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {raffle.winners.map((w) => (
              <li key={w.id}>
                <span className="text-kos-muted">{w.position}.</span>{" "}
                {w.username}
              </li>
            ))}
          </ol>
          {raffle.drawSeedHash ? (
            <p className="mt-3 text-[11px] text-kos-muted">
              Verifiable draw · commitment{" "}
              <code>{raffle.drawSeedHash.slice(0, 24)}…</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kos-metric text-center lg:text-left">
      <div className="truncate text-base font-semibold sm:text-lg">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}
