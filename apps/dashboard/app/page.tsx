"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { StatCard, StatusBadge, PageTitle, Segmented, Card, SectionTitle, Empty } from "@/components/ui";
import { BarChart } from "@/components/BarChart";
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
    trends: { raffles: number; entries: number; winners: number } | null;
  };
  series: { label: string; value: number }[];
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
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "all", label: "All" },
];

export default function OverviewPage() {
  const [range, setRange] = useState("7d");
  const [copied, setCopied] = useState(false);
  const { data } = useSWR<Overview>(`/api/overview?range=${range}`, fetcher, {
    refreshInterval: 5000,
  });
  const s = data?.stats;
  const t = s?.trends ?? null;
  const label = RANGES.find((r) => r.key === range)?.label ?? range;

  async function copyStats() {
    if (!s) return;
    const text = [
      `KOS Raffle Stats — ${label}`,
      `Raffles: ${s.rangeRaffles}`,
      `Entries: ${s.rangeEntries}`,
      `Unique participants: ${s.uniqueParticipants}`,
      `Winners: ${s.rangeWinners}`,
      `Live now: ${s.liveRaffles}`,
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
        subtitle="Live raffle activity across your communities."
        action={
          <>
            <Segmented options={RANGES as any} value={range} onChange={setRange} />
            <button className="kos-btn" onClick={copyStats}>
              {copied ? "Copied ✓" : "Copy stats"}
            </button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent label="Entries" value={s?.rangeEntries ?? "—"} trend={t?.entries} hint={`last ${label.toLowerCase()}`} />
        <StatCard label="Raffles" value={s?.rangeRaffles ?? "—"} trend={t?.raffles} hint={`last ${label.toLowerCase()}`} />
        <StatCard label="Unique Players" value={s?.uniqueParticipants ?? "—"} hint="distinct entrants" />
        <StatCard label="Winners" value={s?.rangeWinners ?? "—"} trend={t?.winners} hint={`last ${label.toLowerCase()}`} />
      </div>

      {/* Chart + side panel */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle>Entry Activity</SectionTitle>
          <BarChart data={data?.series ?? []} />
        </Card>

        <Card>
          <SectionTitle>At a glance</SectionTitle>
          <div className="space-y-3">
            <div className="flex items-end justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-white/45">Live now</div>
                <div className="mt-1 text-3xl font-semibold">{s?.liveRaffles ?? "—"}</div>
              </div>
              <span className="kos-badge border-emerald-400/30 text-emerald-300/90">running</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-sm text-white/55">Total raffles</span>
              <span className="text-lg font-semibold">{s?.totalRaffles ?? "—"}</span>
            </div>
            <Link href="/raffles" className="kos-btn w-full">View all raffles</Link>
          </div>
        </Card>
      </div>

      {/* Live & upcoming */}
      <div className="mt-6">
        <SectionTitle>Live &amp; Upcoming</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.live.length === 0 ? (
          <Empty>No live or upcoming raffles.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.live.map((r) => (
              <Link
                key={r.id}
                href={`/raffles/${r.id}`}
                className="kos-card kos-card-hover flex items-center justify-between p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/40">#{r.id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 truncate font-medium">{r.projectName}</div>
                  <div className="truncate text-sm text-white/45">{r.title}</div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-lg font-semibold">
                    {r.entryCount}
                    <span className="text-white/40"> / {r.spots}</span>
                  </div>
                  <div className="text-xs text-white/40">ends {fmtDate(r.endAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
