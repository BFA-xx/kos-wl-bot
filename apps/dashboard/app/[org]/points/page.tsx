"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Empty,
  PageTitle,
  SectionTitle,
  StatCard,
  TableShell,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PointsData {
  totalPoints: number;
  eventCount: number;
  leaderboard: {
    rank: number;
    userId: string;
    name: string;
    avatarUrl: string | null;
    points: number;
    events: number;
  }[];
  recent: {
    id: string;
    name: string;
    avatarUrl: string | null;
    delta: number;
    reason: string;
    createdAt: string;
  }[];
  guilds: {
    id: string;
    name: string;
    pointsChannelId: string | null;
  }[];
  error?: string;
}

export default function PointsPage() {
  const { org } = useParams<{ org: string }>();
  const { data, mutate } = useSWR<PointsData>(`/api/${org}/points`, fetcher, {
    refreshInterval: 15000,
  });

  return (
    <>
      <PageTitle
        title="Points"
        subtitle="A live ledger of member points earned from verified tasks. Campaigns and rewards build on this balance."
        action={
          <Link href={`/${org}/rewards`} className="kos-btn-primary">
            Manage rewards
          </Link>
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
            <StatCard label="Award events" value={data?.eventCount ?? "—"} />
            <StatCard
              label="Members ranked"
              value={data?.leaderboard.length ?? "—"}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
            <div>
              <SectionTitle>Leaderboard</SectionTitle>
              {!data ? (
                <Empty>Loading points…</Empty>
              ) : data.leaderboard.length === 0 ? (
                <Empty>
                  No points have been awarded yet. Add points to tasks and let
                  members verify them.
                </Empty>
              ) : (
                <TableShell>
                  <table className="kos-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Member</th>
                        <th className="text-right">Points</th>
                        <th className="text-right">Events</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaderboard.map((row) => (
                        <tr key={row.userId}>
                          <td className="text-kos-muted">#{row.rank}</td>
                          <td>
                            <div className="flex min-w-0 items-center gap-2">
                              <Avatar name={row.name} src={row.avatarUrl} />
                              <span className="truncate font-medium">
                                {row.name}
                              </span>
                            </div>
                          </td>
                          <td className="text-right font-semibold">
                            {row.points}
                          </td>
                          <td className="text-right text-kos-muted">
                            {row.events}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </div>

            <div>
              <PointsChannelCard org={org} data={data} mutate={mutate} />

              <SectionTitle>Recent awards</SectionTitle>
              {!data ? (
                <Empty>Loading…</Empty>
              ) : data.recent.length === 0 ? (
                <Empty>No award events yet.</Empty>
              ) : (
                <div className="grid gap-2">
                  {data.recent.map((row) => (
                    <div
                      key={row.id}
                      className="kos-card flex items-center gap-3 p-3"
                    >
                      <Avatar name={row.name} src={row.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {row.name}
                        </div>
                        <div className="truncate text-xs text-kos-muted">
                          {row.reason}
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
        </>
      )}
    </>
  );
}

function PointsChannelCard({
  org,
  data,
  mutate,
}: {
  org: string;
  data?: PointsData;
  mutate: () => void;
}) {
  const guilds = data?.guilds ?? [];
  const [guildId, setGuildId] = useState("");
  const current = guilds.find((g) => g.id === guildId) ?? guilds[0];
  const { data: meta } = useSWR<{ channels: { id: string; name: string }[] }>(
    current ? `/api/${org}/guilds/${current.id}/meta` : null,
    fetcher,
  );
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!guildId && guilds[0]) setGuildId(guilds[0].id);
  }, [guildId, guilds]);
  useEffect(() => {
    setChannelId(current?.pointsChannelId ?? "");
  }, [current?.id, current?.pointsChannelId]);

  async function save() {
    if (!current) return;
    setSaving(true);
    setMsg("");
    const res = await fetch(`/api/${org}/points`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: current.id, pointsChannelId: channelId }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? "Points channel saved." : body.error || "Could not save channel.");
    if (res.ok) mutate();
  }

  return (
    <div className="kos-card mb-5 p-4">
      <SectionTitle>Points channel</SectionTitle>
      {guilds.length === 0 ? (
        <p className="text-sm text-kos-muted">
          Connect a Discord server before hosting points in a channel.
        </p>
      ) : (
        <div className="space-y-3">
          {guilds.length > 1 ? (
            <select className="kos-input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          ) : null}
          <select className="kos-input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">No points channel</option>
            {(meta?.channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-kos-muted">
            KOS posts task awards, reward redemptions, and `/points panel`
            updates here.
          </p>
          <div className="flex items-center gap-2">
            <button className="kos-btn-primary text-xs" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save channel"}
            </button>
            {msg ? <span className="text-xs text-kos-muted">{msg}</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06] text-[10px] font-bold">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
