"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { Empty, PageTitle, SectionTitle, StatCard } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Reward {
  id: string;
  title: string;
  description: string | null;
  cost: number;
  stock: number | null;
  balance: number;
  org: { slug: string; name: string; logoUrl: string | null };
}

interface Redemption {
  id: string;
  rewardTitle: string;
  org: { slug: string; name: string; logoUrl: string | null };
  cost: number;
  status: string;
  createdAt: string;
  fulfilledAt: string | null;
}

interface RewardsData {
  rewards: Reward[];
  redemptions: Redemption[];
  error?: string;
}

export default function MeRewardsPage() {
  const { data, mutate } = useSWR<RewardsData>("/api/me/rewards", fetcher, {
    refreshInterval: 15000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function redeem(id: string) {
    setBusy(id);
    const res = await fetch(`/api/me/rewards/${id}/redeem`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg((m) => ({
      ...m,
      [id]: res.ok ? "Redeemed — the team will fulfill it soon." : body.error || "Could not redeem.",
    }));
    if (res.ok) mutate();
  }

  const redeemable = data?.rewards.filter((r) => r.balance >= r.cost && (r.stock === null || r.stock > 0)).length ?? 0;

  return (
    <>
      <PageTitle
        title="Rewards"
        subtitle="Spend the points you earn from community tasks."
        action={
          <>
            <Link href="/me/points" className="kos-btn-primary">
              Earn points
            </Link>
            <Link href="/me/raffles" className="kos-btn">
              Raffles
            </Link>
          </>
        }
      />

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard accent label="Available rewards" value={data?.rewards.length ?? "—"} />
            <StatCard label="Redeemable now" value={redeemable} />
            <StatCard label="Claims" value={data?.redemptions.length ?? "—"} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
            <div>
              <SectionTitle>Reward store</SectionTitle>
              {!data ? (
                <Empty>Loading rewards…</Empty>
              ) : data.rewards.length === 0 ? (
                <Empty>No rewards are live yet. Complete tasks and check back soon.</Empty>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.rewards.map((r) => {
                    const canRedeem = r.balance >= r.cost && (r.stock === null || r.stock > 0);
                    return (
                      <div key={r.id} className="kos-card flex flex-col p-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.org.name} src={r.org.logoUrl} />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-kos-muted">{r.org.name}</div>
                            <div className="font-semibold">{r.title}</div>
                          </div>
                        </div>
                        {r.description ? (
                          <p className="mt-3 line-clamp-3 text-sm leading-6 text-kos-muted">
                            {r.description}
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="kos-badge border-blue-400/30 text-blue-300">
                            {r.cost} pts
                          </span>
                          <span className="kos-badge border-white/[0.08] text-kos-muted">
                            You: {r.balance}
                          </span>
                          <span className="kos-badge border-white/[0.08] text-kos-muted">
                            {r.stock === null ? "unlimited" : `${r.stock} left`}
                          </span>
                        </div>
                        <button
                          className="kos-btn-primary mt-4"
                          disabled={!canRedeem || busy === r.id}
                          onClick={() => redeem(r.id)}
                        >
                          {busy === r.id ? "Redeeming…" : canRedeem ? "Redeem" : "Not enough points"}
                        </button>
                        {msg[r.id] ? (
                          <p className="mt-2 text-xs leading-5 text-kos-muted">{msg[r.id]}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <SectionTitle>My claims</SectionTitle>
              {!data ? (
                <Empty>Loading…</Empty>
              ) : data.redemptions.length === 0 ? (
                <Empty>No reward claims yet.</Empty>
              ) : (
                <div className="grid gap-2">
                  {data.redemptions.map((r) => (
                    <div key={r.id} className="kos-card p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.org.name} src={r.org.logoUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{r.rewardTitle}</div>
                          <div className="truncate text-xs text-kos-muted">{r.org.name}</div>
                        </div>
                        <span className="kos-badge border-white/[0.08] text-kos-muted">
                          {r.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-kos-muted">
                        {r.cost} pts · {fmtDate(r.createdAt)}
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
