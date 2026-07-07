"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  Empty,
  PageTitle,
  SectionTitle,
  StatCard,
  TableShell,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Reward {
  id: string;
  title: string;
  description: string | null;
  cost: number;
  stock: number | null;
  active: boolean;
  redemptionCount: number;
}

interface Redemption {
  id: string;
  rewardTitle: string;
  userName: string;
  avatarUrl: string | null;
  cost: number;
  status: string;
  createdAt: string;
}

interface RewardsData {
  rewards: Reward[];
  redemptions: Redemption[];
  error?: string;
}

export default function RewardsPage() {
  const { org } = useParams<{ org: string }>();
  const { data, mutate } = useSWR<RewardsData>(`/api/${org}/rewards`, fetcher, {
    refreshInterval: 15000,
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState(100);
  const [stock, setStock] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/${org}/rewards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description, cost, stock }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "Reward created." : body.error || "Could not create reward.");
    if (res.ok) {
      setTitle("");
      setDescription("");
      setCost(100);
      setStock("");
      mutate();
    }
  }

  async function toggle(r: Reward) {
    await fetch(`/api/${org}/rewards/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    mutate();
  }

  async function close(id: string, status: "FULFILLED" | "CANCELLED") {
    await fetch(`/api/${org}/rewards/redemptions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    mutate();
  }

  const activeCount = data?.rewards.filter((r) => r.active).length ?? 0;
  const pendingCount =
    data?.redemptions.filter((r) => r.status === "PENDING").length ?? 0;

  return (
    <>
      <PageTitle
        title="Rewards"
        subtitle="Let members spend earned KOS points on perks, roles, WL upgrades, merch, or custom prizes."
      />

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard accent label="Active rewards" value={activeCount} />
            <StatCard label="Pending claims" value={pendingCount} />
            <StatCard label="Total claims" value={data?.redemptions.length ?? "—"} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[26rem_1fr]">
            <div className="space-y-5">
              <div className="kos-card p-5">
                <SectionTitle>Create reward</SectionTitle>
                <form onSubmit={create} className="space-y-3">
                  <input
                    className="kos-input"
                    placeholder="Reward title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                  <textarea
                    className="kos-input min-h-24"
                    placeholder="What does the member receive?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="kos-label">Cost</span>
                      <input
                        className="kos-input"
                        type="number"
                        min={1}
                        value={cost}
                        onChange={(e) => setCost(Number(e.target.value))}
                      />
                    </label>
                    <label className="block">
                      <span className="kos-label">Stock</span>
                      <input
                        className="kos-input"
                        type="number"
                        min={0}
                        placeholder="Unlimited"
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className="kos-btn-primary w-full" disabled={busy || !title.trim()}>
                    {busy ? "Creating…" : "Create reward"}
                  </button>
                  {msg ? <p className="text-sm text-kos-muted">{msg}</p> : null}
                </form>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <SectionTitle>Reward store</SectionTitle>
                {!data ? (
                  <Empty>Loading rewards…</Empty>
                ) : data.rewards.length === 0 ? (
                  <Empty>Create your first reward to launch the store.</Empty>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.rewards.map((r) => (
                      <div key={r.id} className="kos-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold">{r.title}</div>
                            {r.description ? (
                              <p className="mt-1 line-clamp-3 text-sm leading-6 text-kos-muted">
                                {r.description}
                              </p>
                            ) : null}
                          </div>
                          <span className={`kos-badge ${r.active ? "border-emerald-400/30 text-emerald-400" : "border-amber-400/30 text-amber-400"}`}>
                            {r.active ? "active" : "paused"}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                          <span className="kos-badge border-blue-400/30 text-blue-300">
                            {r.cost} pts
                          </span>
                          <span className="kos-badge border-white/[0.08] text-kos-muted">
                            {r.stock === null ? "unlimited" : `${r.stock} left`}
                          </span>
                          <span className="kos-badge border-white/[0.08] text-kos-muted">
                            {r.redemptionCount} claims
                          </span>
                        </div>
                        <button className="kos-btn mt-4 text-xs" onClick={() => toggle(r)}>
                          {r.active ? "Pause" : "Activate"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <SectionTitle>Redemptions</SectionTitle>
                {!data ? (
                  <Empty>Loading claims…</Empty>
                ) : data.redemptions.length === 0 ? (
                  <Empty>No reward claims yet.</Empty>
                ) : (
                  <TableShell>
                    <table className="kos-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Reward</th>
                          <th>Status</th>
                          <th>Cost</th>
                          <th>Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.redemptions.map((r) => (
                          <tr key={r.id}>
                            <td>{r.userName}</td>
                            <td>{r.rewardTitle}</td>
                            <td>{r.status}</td>
                            <td>{r.cost}</td>
                            <td className="text-kos-muted">{fmtDate(r.createdAt)}</td>
                            <td className="text-right">
                              {r.status === "PENDING" ? (
                                <div className="flex justify-end gap-2">
                                  <button className="kos-btn text-xs" onClick={() => close(r.id, "CANCELLED")}>
                                    Refund
                                  </button>
                                  <button className="kos-btn-primary text-xs" onClick={() => close(r.id, "FULFILLED")}>
                                    Fulfill
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableShell>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
