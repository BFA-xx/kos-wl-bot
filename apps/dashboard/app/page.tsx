"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { StatCard, StatusBadge, PageTitle, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Overview {
  range: string;
  stats: {
    totalRaffles: number;
    liveRaffles: number;
    rangeRaffles: number;
    rangeEntries: number;
    rangeWinners: number;
    uniqueParticipants: number;
  };
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

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "all", label: "All time" },
];

export default function OverviewPage() {
  const [range, setRange] = useState("7d");
  const [copied, setCopied] = useState(false);
  const { data } = useSWR<Overview>(`/api/overview?range=${range}`, fetcher, {
    refreshInterval: 5000,
  });
  const stats = data?.stats;
  const label = RANGES.find((r) => r.key === range)?.label ?? range;

  async function copyStats() {
    if (!stats) return;
    const text = [
      `KOS Raffle Stats — last ${label}`,
      `Raffles created: ${stats.rangeRaffles}`,
      `Entries: ${stats.rangeEntries}`,
      `Unique participants: ${stats.uniqueParticipants}`,
      `Winners drawn: ${stats.rangeWinners}`,
      `Live now: ${stats.liveRaffles}`,
      `Total raffles all-time: ${stats.totalRaffles}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <Shell>
      <PageTitle
        title="Overview"
        subtitle="Live raffle activity across all communities."
        action={
          <button className="kos-btn" onClick={copyStats}>
            {copied ? "Copied ✓" : "Copy stats"}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              range === r.key
                ? "border-kos-silver text-kos-white"
                : "border-kos-border text-kos-grey hover:text-kos-white"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={`Raffles (${label})`} value={stats?.rangeRaffles ?? "—"} />
        <StatCard label={`Entries (${label})`} value={stats?.rangeEntries ?? "—"} />
        <StatCard label="Unique Participants" value={stats?.uniqueParticipants ?? "—"} />
        <StatCard label={`Winners (${label})`} value={stats?.rangeWinners ?? "—"} />
        <StatCard label="Live Now" value={stats?.liveRaffles ?? "—"} />
        <StatCard label="Total Raffles" value={stats?.totalRaffles ?? "—"} />
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-grey">
        Live &amp; Upcoming
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
