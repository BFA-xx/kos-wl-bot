"use client";

import Link from "next/link";
import useSWR from "swr";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EntryPanel } from "@/components/EntryPanel";
import { MemberTasksWorkspace } from "@/components/MemberTasksWorkspace";
import { Empty, PageTitle, SectionTitle, StatCard } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface RaffleSummary {
  id: number;
  org: { slug: string; name: string; logoUrl: string | null } | null;
  projectName: string;
  title: string;
  description: string | null;
  status: string;
  endAt: string;
  spots: number;
  entryCount: number | null;
  bannerUrl: string | null;
  entered: boolean;
}

interface RafflesData {
  raffles?: RaffleSummary[];
  error?: string;
}

export default function MeRafflesPage() {
  return (
    <Suspense fallback={<Empty>Loading raffles…</Empty>}>
      <MeRafflesInner />
    </Suspense>
  );
}

function MeRafflesInner() {
  const params = useSearchParams();
  const focusedRaffleId = params.get("raffle");
  const { data } = useSWR<RafflesData>("/api/me/tasks", fetcher, {
    refreshInterval: 15000,
  });
  const raffles = data?.raffles ?? [];
  const entered = raffles.filter((r) => r.entered).length;

  if (focusedRaffleId) {
    return (
      <>
        <PageTitle
          title="Raffle entry"
          subtitle="Open each raffle step, verify it, then enter from this same tab."
          action={
            <Link href="/me/raffles" className="kos-btn">
              All raffles
            </Link>
          }
        />
        <MemberTasksWorkspace embedded />
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="Raffles"
        subtitle="Browse live raffles, complete raffle-specific steps, and enter from one clean panel."
        action={
          <>
            <Link href="/me/points" className="kos-btn">
              Earn points
            </Link>
            <Link href="/me/rewards" className="kos-btn">
              Rewards
            </Link>
          </>
        }
      />

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard accent label="Live raffles" value={data ? raffles.length : "—"} />
            <StatCard label="Entered" value={data ? entered : "—"} />
            <StatCard
              label="Open spots"
              value={data ? raffles.reduce((sum, r) => sum + r.spots, 0) : "—"}
            />
          </div>

          <SectionTitle>Enter raffles</SectionTitle>
          {!data ? (
            <Empty>Loading raffles…</Empty>
          ) : raffles.length === 0 ? (
            <Empty>
              No live raffles right now. When a community opens one, it will
              appear here.
            </Empty>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {raffles.map((raffle) => (
                <RaffleEntryCard key={raffle.id} raffle={raffle} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function RaffleEntryCard({ raffle }: { raffle: RaffleSummary }) {
  return (
    <div className="kos-card overflow-hidden">
      {raffle.bannerUrl ? (
        <div className="border-b border-white/[0.08] bg-white/[0.025] px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={raffle.bannerUrl}
            alt=""
            className="mx-auto block max-h-[220px] w-auto max-w-full rounded-3xl object-contain"
          />
        </div>
      ) : null}
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {raffle.org ? (
              <div className="mb-2 flex items-center gap-2 text-xs text-kos-muted">
                <CommunityAvatar org={raffle.org} />
                {raffle.org.name}
              </div>
            ) : null}
            <h2 className="break-words text-lg font-semibold">
              {raffle.projectName}
            </h2>
            <p className="mt-0.5 text-sm text-kos-muted">{raffle.title}</p>
            {raffle.description ? (
              <p className="mt-2 line-clamp-2 text-sm text-kos-muted">
                {raffle.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <span className="kos-badge border-emerald-400/30 text-emerald-400">
              LIVE
            </span>
            {raffle.entered ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                entered
              </span>
            ) : null}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Ends" value={fmtDate(raffle.endAt)} />
          <MiniStat
            label="Entries"
            value={raffle.entryCount === null ? "—" : raffle.entryCount}
          />
          <MiniStat label="Spots" value={raffle.spots} />
        </div>

        <EntryPanel raffleId={raffle.id} compact />

        {raffle.org ? (
          <div className="mt-3 text-right">
            <Link
              href={`/c/${raffle.org.slug}/raffles/${raffle.id}`}
              className="text-xs text-kos-muted underline-offset-2 hover:text-kos-fg hover:underline"
            >
              View public raffle page →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommunityAvatar({
  org,
}: {
  org: { name: string; logoUrl: string | null };
}) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-kos-fg text-[9px] font-black text-kos-bg">
      {org.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={org.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        org.name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kos-metric p-3">
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-kos-muted">
        {label}
      </div>
    </div>
  );
}
