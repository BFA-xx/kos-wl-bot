"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { StatCard, StatusBadge, PageTitle, Segmented, Card, SectionTitle, Empty } from "@/components/ui";
import { AreaChart } from "@/components/AreaChart";
import { RaffleQuickActions } from "@/components/RaffleQuickActions";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Overview {
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
  const { org } = useParams<{ org: string }>();
  const [range, setRange] = useState("7d");
  const [copied, setCopied] = useState(false);
  const canCreate = useCan(PERMISSIONS.RAFFLE_CREATE);
  const canEdit = useCan(PERMISSIONS.RAFFLE_EDIT);
  const { data } = useSWR<Overview>(`/api/${org}/overview?range=${range}`, fetcher, {
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
    <>
      <PageTitle
        title="Dashboard"
        subtitle="Your command center for raffle performance, community activity, and what needs attention."
        action={
          <>
            <Segmented options={RANGES as any} value={range} onChange={setRange} />
            <button className="kos-btn" onClick={copyStats}>
              {copied ? "Copied ✓" : "Copy stats"}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard accent label="Entries" value={s?.rangeEntries ?? "—"} trend={t?.entries} hint={`last ${label.toLowerCase()}`} />
        <StatCard label="Raffles" value={s?.rangeRaffles ?? "—"} trend={t?.raffles} hint={`last ${label.toLowerCase()}`} />
        <StatCard label="Unique Players" value={s?.uniqueParticipants ?? "—"} hint="distinct entrants" />
        <StatCard label="Winners" value={s?.rangeWinners ?? "—"} trend={t?.winners} hint={`last ${label.toLowerCase()}`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            action={<span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[11px] text-kos-muted">Live refresh</span>}
          >
            Entry Activity
          </SectionTitle>
          <AreaChart data={data?.series ?? []} />
        </Card>

        <Card>
          <SectionTitle>At a glance</SectionTitle>
          <div className="space-y-3">
            <div className="flex items-end justify-between rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-kos-muted">Live now</div>
                <div className="mt-1 text-3xl font-semibold">{s?.liveRaffles ?? "—"}</div>
              </div>
              <span className="kos-badge border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90">running</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
              <span className="text-sm text-kos-muted">Total raffles</span>
              <span className="text-lg font-semibold">{s?.totalRaffles ?? "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/${org}/raffles`} className="kos-btn w-full">Raffles</Link>
              <Link href={`/${org}/tasks`} className="kos-btn-primary w-full">Tasks</Link>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <SectionTitle>Live &amp; Upcoming</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.live.length === 0 ? (
          <Empty>No live or upcoming raffles.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.live.map((r) => (
              <div
                key={r.id}
                className="kos-card kos-card-hover flex items-center gap-2 p-2"
              >
                <Link
                  href={`/${org}/raffles/${r.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-2xl p-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-kos-muted">#{r.id}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="mt-1 truncate font-medium">{r.projectName}</div>
                    <div className="truncate text-sm text-kos-muted">{r.title}</div>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <div className="text-lg font-semibold">
                      {r.entryCount}
                      <span className="text-kos-muted"> / {r.spots}</span>
                    </div>
                    <div className="text-xs text-kos-muted">ends {fmtDate(r.endAt)}</div>
                  </div>
                </Link>
                <RaffleQuickActions
                  raffleId={r.id}
                  canDuplicate={canCreate}
                  editHref={canEdit ? `/${org}/raffles/${r.id}?edit=1` : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
