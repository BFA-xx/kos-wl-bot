"use client";

import useSWR from "swr";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatCard, StatusBadge, PageTitle, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Overview {
  stats: { totalRaffles: number; liveRaffles: number; totalWinners: number; totalEntries: number };
  live: {
    id: number;
    projectName: string;
    title: string;
    status: string;
    spots: number;
    entryCount: number;
    endAt: string;
  }[];
}

export default function OverviewPage() {
  // Live updates without refresh: poll every 5s.
  const { data } = useSWR<Overview>("/api/overview", fetcher, { refreshInterval: 5000 });
  const stats = data?.stats;

  return (
    <Shell>
      <PageTitle title="Overview" subtitle="Live raffle activity across all communities." />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Raffles" value={stats?.totalRaffles ?? "—"} />
        <StatCard label="Live Now" value={stats?.liveRaffles ?? "—"} />
        <StatCard label="Total Entries" value={stats?.totalEntries ?? "—"} />
        <StatCard label="Total Winners" value={stats?.totalWinners ?? "—"} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-grey">
        Live & Upcoming
      </h2>
      {!data ? (
        <Empty>Loading…</Empty>
      ) : data.live.length === 0 ? (
        <Empty>No live or upcoming raffles.</Empty>
      ) : (
        <div className="grid gap-3">
          {data.live.map((r) => (
            <Link
              key={r.id}
              href={`/raffles/${r.id}`}
              className="kos-card flex items-center justify-between p-4 transition-colors hover:border-kos-silver"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-kos-grey">#{r.id}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-1 font-medium">{r.title}</div>
                <div className="text-sm text-kos-grey">{r.projectName}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">
                  {r.entryCount}
                  <span className="text-kos-grey"> / {r.spots} spots</span>
                </div>
                <div className="text-xs text-kos-grey">Ends {fmtDate(r.endAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
