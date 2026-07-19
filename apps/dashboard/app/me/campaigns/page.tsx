"use client";

import Link from "next/link";
import useSWR from "swr";
import { useState } from "react";
import { Empty, PageTitle, StatCard } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

interface CampaignStep {
  id: string;
  kind: "TASK" | "RAFFLE";
  sourceId: string;
  title: string;
  description: string | null;
  required: boolean;
  done: boolean;
  active: boolean;
  points: number;
  actionUrl: string | null;
  rafflePath: string | null;
}

interface CampaignRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startAt: string | null;
  endAt: string | null;
  completionPoints: number;
  org: { id: string; slug: string; name: string; logoUrl: string | null };
  enrollment: {
    status: string;
    joinedAt: string;
    completedAt: string | null;
  } | null;
  progress: {
    done: number;
    total: number;
    requiredDone: number;
    requiredTotal: number;
    complete: boolean;
  } | null;
  steps: CampaignStep[];
}

interface CampaignResponse {
  campaigns: CampaignRow[];
  error?: string;
}

export default function MemberCampaignsPage() {
  const { data, mutate } = useSWR<CampaignResponse>(
    "/api/me/campaigns",
    fetcher,
    {
      refreshInterval: 15_000,
    },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const campaigns = data?.campaigns ?? [];
  const joined = campaigns.filter((campaign) => campaign.enrollment).length;
  const completed = campaigns.filter(
    (campaign) => campaign.enrollment?.status === "COMPLETED",
  ).length;
  const live = campaigns.filter(
    (campaign) => campaign.status === "LIVE",
  ).length;

  async function join(campaign: CampaignRow) {
    setBusy(campaign.id);
    const response = await fetch(`/api/me/campaigns/${campaign.id}/join`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessages((current) => ({
      ...current,
      [campaign.id]: response.ok
        ? "Campaign joined — your existing progress has been counted."
        : (body.error ?? "Could not join."),
    }));
    await mutate();
  }

  async function sync(campaign: CampaignRow) {
    setBusy(campaign.id);
    const response = await fetch(`/api/me/campaigns/${campaign.id}/sync`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessages((current) => ({
      ...current,
      [campaign.id]: response.ok
        ? body.result?.completedNow
          ? `Campaign completed${body.result.awardedPoints ? ` — +${body.result.awardedPoints} points earned!` : "!"}`
          : "Progress refreshed."
        : (body.error ?? "Could not refresh progress."),
    }));
    await mutate();
  }

  async function openTask(campaign: CampaignRow, step: CampaignStep) {
    if (step.actionUrl)
      window.open(step.actionUrl, "_blank", "noopener,noreferrer");
    if (!step.actionUrl) return;
    await fetch(`/api/me/tasks/${step.sourceId}/click`, { method: "POST" });
    setMessages((current) => ({
      ...current,
      [campaign.id]: "Task opened — return here and verify when finished.",
    }));
  }

  async function verifyTask(campaign: CampaignRow, step: CampaignStep) {
    setBusy(step.id);
    const response = await fetch(`/api/me/tasks/${step.sourceId}/complete`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok)
      await fetch(`/api/me/campaigns/${campaign.id}/sync`, { method: "POST" });
    setBusy(null);
    setMessages((current) => ({
      ...current,
      [campaign.id]: response.ok
        ? (body.reason ?? "Task verified.")
        : (body.reason ?? body.error ?? "Verification failed."),
    }));
    await mutate();
  }

  return (
    <>
      <PageTitle
        title="Campaigns"
        subtitle="Join community journeys, complete quests and raffles, and unlock completion points."
        action={
          <Link href="/me/points" className="kos-btn">
            My points
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard accent label="Live journeys" value={live} />
        <StatCard label="Joined" value={joined} />
        <StatCard label="Completed" value={completed} />
      </div>

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : !data ? (
        <Empty>Loading campaigns…</Empty>
      ) : campaigns.length === 0 ? (
        <Empty>No community campaigns are available yet.</Empty>
      ) : (
        <div className="space-y-5">
          {campaigns.map((campaign) => {
            const percent = campaign.progress?.total
              ? Math.round(
                  (campaign.progress.done / campaign.progress.total) * 100,
                )
              : 0;
            const enrolled = Boolean(campaign.enrollment);
            const finished = campaign.enrollment?.status === "COMPLETED";
            const open = campaign.status === "LIVE";
            return (
              <article key={campaign.id} className="kos-card overflow-hidden">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] text-xs font-bold">
                        {campaign.org.logoUrl ? (
                          <img
                            src={campaign.org.logoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          campaign.org.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-kos-muted">
                          {campaign.org.name}
                        </div>
                        <h2 className="text-lg font-semibold">
                          {campaign.title}
                        </h2>
                        {campaign.description ? (
                          <p className="mt-1 max-w-3xl text-sm leading-6 text-kos-muted">
                            {campaign.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CampaignStatus status={campaign.status} />
                      {finished ? (
                        <span className="kos-badge border-emerald-400/30 text-emerald-400">
                          Completed ✓
                        </span>
                      ) : null}
                      {campaign.completionPoints > 0 ? (
                        <span className="kos-badge border-blue-400/30 text-blue-300">
                          +{campaign.completionPoints} finish bonus
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between text-xs text-kos-muted">
                      <span>
                        {campaign.progress?.done ?? 0} of{" "}
                        {campaign.progress?.total ?? campaign.steps.length}{" "}
                        steps complete
                      </span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-kos-muted">
                    {campaign.startAt ? (
                      <span>Starts {fmtDate(campaign.startAt)}</span>
                    ) : null}
                    {campaign.startAt && campaign.endAt ? <span>·</span> : null}
                    {campaign.endAt ? (
                      <span>Ends {fmtDate(campaign.endAt)}</span>
                    ) : (
                      <span>No fixed end</span>
                    )}
                  </div>

                  <div className="mt-5 space-y-2">
                    {campaign.steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3"
                      >
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.05] text-kos-muted"}`}
                        >
                          {step.done ? "✓" : index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {step.title}
                          </div>
                          <div className="text-xs text-kos-muted">
                            {step.kind === "TASK"
                              ? `Quest${step.points > 0 ? ` · +${step.points} points` : ""}`
                              : "Raffle entry"}
                            {step.required ? " · required" : " · optional"}
                          </div>
                        </div>
                        {enrolled && open && !step.done ? (
                          step.kind === "RAFFLE" && step.rafflePath ? (
                            <Link
                              href={step.rafflePath}
                              className="kos-btn-primary text-xs"
                            >
                              Open raffle
                            </Link>
                          ) : step.actionUrl ? (
                            <>
                              <button
                                className="kos-btn text-xs"
                                onClick={() => openTask(campaign, step)}
                              >
                                Open task
                              </button>
                              <button
                                className="kos-btn-primary text-xs"
                                disabled={busy === step.id}
                                onClick={() => verifyTask(campaign, step)}
                              >
                                {busy === step.id ? "Checking…" : "Verify"}
                              </button>
                            </>
                          ) : (
                            <button
                              className="kos-btn-primary text-xs"
                              disabled={busy === step.id}
                              onClick={() => verifyTask(campaign, step)}
                            >
                              {busy === step.id ? "Checking…" : "Verify"}
                            </button>
                          )
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    {!enrolled && open ? (
                      <button
                        className="kos-btn-primary"
                        disabled={busy === campaign.id}
                        onClick={() => join(campaign)}
                      >
                        {busy === campaign.id ? "Joining…" : "Join campaign"}
                      </button>
                    ) : null}
                    {enrolled && open && !finished ? (
                      <button
                        className="kos-btn"
                        disabled={busy === campaign.id}
                        onClick={() => sync(campaign)}
                      >
                        {busy === campaign.id
                          ? "Refreshing…"
                          : "Check progress"}
                      </button>
                    ) : null}
                    {campaign.status === "SCHEDULED" ? (
                      <span className="text-sm text-kos-muted">
                        This journey has not opened yet.
                      </span>
                    ) : null}
                    {campaign.status === "ENDED" && !finished ? (
                      <span className="text-sm text-kos-muted">
                        This campaign has ended.
                      </span>
                    ) : null}
                    {messages[campaign.id] ? (
                      <span className="text-sm text-kos-muted">
                        {messages[campaign.id]}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function CampaignStatus({ status }: { status: string }) {
  const cls =
    status === "LIVE"
      ? "border-emerald-400/30 text-emerald-400"
      : status === "SCHEDULED"
        ? "border-blue-400/30 text-blue-300"
        : "border-white/[0.08] text-kos-muted";
  return <span className={`kos-badge ${cls}`}>{status.toLowerCase()}</span>;
}
