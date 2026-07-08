"use client";

import Link from "next/link";
import useSWR from "swr";
import { Empty, PageTitle, SectionTitle, StatCard } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { MemberTasksWorkspace } from "@/components/MemberTasksWorkspace";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PointsData {
  totalPoints: number;
  balances: {
    organizationId: string;
    org: { slug: string; name: string; logoUrl: string | null };
    points: number;
    events: number;
  }[];
  recent: {
    id: string;
    delta: number;
    reason: string;
    createdAt: string;
    org: { slug: string; name: string; logoUrl: string | null };
  }[];
  error?: string;
}

export default function MePointsPage() {
  const { data } = useSWR<PointsData>("/api/me/points", fetcher, {
    refreshInterval: 15000,
  });

  return (
    <>
      <PageTitle
        title="Points"
        subtitle="Earn points by completing community tasks below, then spend them on rewards."
        action={
          <>
            <Link href="/me/rewards" className="kos-btn">
              Spend points
            </Link>
            <Link href="/me/raffles" className="kos-btn-primary">
              Enter raffles
            </Link>
          </>
        }
      />

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard
              accent
              label="Total points"
              value={data?.totalPoints ?? "—"}
            />
            <StatCard
              label="Communities"
              value={data?.balances.length ?? "—"}
            />
            <StatCard label="Award events" value={data?.recent.length ?? "—"} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
            <div>
              <SectionTitle>Balances</SectionTitle>
              {!data ? (
                <Empty>Loading points…</Empty>
              ) : data.balances.length === 0 ? (
                <Empty>
                  No points yet. Complete the tasks below to start earning.
                </Empty>
              ) : (
                <div className="grid gap-3">
                  {data.balances.map((row) => (
                    <Link
                      key={row.organizationId}
                      href={
                        row.org.slug ? `/c/${row.org.slug}` : "/me/communities"
                      }
                      className="kos-card kos-card-hover flex items-center gap-3 p-4"
                    >
                      <Avatar name={row.org.name} src={row.org.logoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {row.org.name}
                        </div>
                        <div className="text-xs text-kos-muted">
                          {row.events} award events
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-semibold">
                          {row.points}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-kos-muted">
                          points
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div>
              <SectionTitle>Recent activity</SectionTitle>
              {!data ? (
                <Empty>Loading…</Empty>
              ) : data.recent.length === 0 ? (
                <Empty>No point activity yet.</Empty>
              ) : (
                <div className="grid gap-2">
                  {data.recent.map((row) => (
                    <div
                      key={row.id}
                      className="kos-card flex items-center gap-3 p-3"
                    >
                      <Avatar name={row.org.name} src={row.org.logoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {row.reason}
                        </div>
                        <div className="truncate text-xs text-kos-muted">
                          {row.org.name}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-emerald-400">
                          +{row.delta}
                        </div>
                        <div className="text-[10px] text-kos-muted">
                          {fmtDate(row.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-8">
            <MemberTasksWorkspace embedded />
          </div>
        </>
      )}
    </>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06] text-[10px] font-bold">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
