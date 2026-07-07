"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import {
  PageTitle,
  StatCard,
  Card,
  SectionTitle,
  Segmented,
  Empty,
  StatusBadge,
  TableShell,
} from "@/components/ui";
import { AreaChart } from "@/components/AreaChart";
import { BarChart } from "@/components/BarChart";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Analytics {
  entriesSeries: { label: string; value: number }[];
  rafflesSeries: { label: string; value: number }[];
  topRaffles: {
    id: number;
    projectName: string;
    title: string;
    entryCount: number;
    spots: number;
    status: string;
    createdByName: string | null;
  }[];
  hosts: { name: string; raffles: number; entries: number }[];
  totalEntries: number;
  totalRaffles: number;
  error?: string;
}

const RANGES = [
  { key: "7", label: "7D" },
  { key: "30", label: "30D" },
  { key: "90", label: "90D" },
];

export default function AnalyticsPage() {
  const { org } = useParams<{ org: string }>();
  const [days, setDays] = useState("30");
  const { data } = useSWR<Analytics>(
    `/api/${org}/analytics?days=${days}`,
    fetcher,
  );

  if (data?.error) {
    return (
      <>
        <PageTitle
          title="Analytics"
          subtitle="Performance across your raffles."
        />
        <Empty>You don't have permission to view analytics.</Empty>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="Analytics"
        subtitle="Performance across your raffles."
        action={
          <Segmented options={RANGES as any} value={days} onChange={setDays} />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          accent
          label="Total entries"
          value={data?.totalEntries ?? "—"}
        />
        <StatCard label="Total raffles" value={data?.totalRaffles ?? "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Entries over time</SectionTitle>
          <AreaChart data={data?.entriesSeries ?? []} />
        </Card>
        <Card>
          <SectionTitle>Raffles created</SectionTitle>
          <BarChart data={data?.rafflesSeries ?? []} />
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>Top raffles by entries</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.topRaffles.length === 0 ? (
          <Empty>No raffles yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.topRaffles.map((r) => (
              <Link
                key={r.id}
                href={`/${org}/raffles/${r.id}`}
                className="kos-card kos-card-hover flex items-center justify-between p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-kos-muted">#{r.id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 truncate font-medium">
                    {r.projectName}
                  </div>
                  <div className="truncate text-sm text-kos-muted">
                    {r.title}
                  </div>
                  {r.createdByName ? (
                    <div className="truncate text-xs text-kos-muted/80">
                      Hosted by {r.createdByName}
                    </div>
                  ) : null}
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-lg font-semibold">{r.entryCount}</div>
                  <div className="text-xs text-kos-muted">{r.spots} spots</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <SectionTitle>Top hosts</SectionTitle>
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.hosts.length === 0 ? (
          <Empty>No hosts yet.</Empty>
        ) : (
          <TableShell>
            <table className="kos-table">
              <thead>
                <tr>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3 text-right">Raffles</th>
                  <th className="px-4 py-3 text-right">Entries drawn</th>
                </tr>
              </thead>
              <tbody>
                {data.hosts.map((h) => (
                  <tr key={h.name}>
                    <td className="px-4 py-3 font-medium">{h.name}</td>
                    <td className="px-4 py-3 text-right">{h.raffles}</td>
                    <td className="px-4 py-3 text-right text-kos-muted">
                      {h.entries}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </div>
    </>
  );
}
