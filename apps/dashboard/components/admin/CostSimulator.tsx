"use client";

import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";

/**
 * Pre-flight cost estimate for a raffle.
 *
 * Runs server-side through the same pricing table the verifier bills against,
 * so the projection and the real spend cannot drift apart in code — only in
 * assumptions, which are printed alongside the number.
 */

interface SimLine {
  label: string;
  requests: number;
  estimatedCostUsd: number;
}

interface SimResult {
  withCaching: {
    lines: SimLine[];
    requests: number;
    estimatedCostUsd: number;
    costPerParticipantUsd: number;
  };
  withoutCaching: { requests: number; estimatedCostUsd: number };
  estimatedSavingsUsd: number;
  assumptions: string[];
}

const PRESETS = [100, 500, 1000, 10000];

export function CostSimulator({ pricing }: { pricing: Record<string, number> }) {
  const [participants, setParticipants] = useState(500);
  const [followTasks, setFollowTasks] = useState(1);
  const [likeTasks, setLikeTasks] = useState(0);
  const [repostTasks, setRepostTasks] = useState(0);
  const [winnerCount, setWinnerCount] = useState(10);
  const [result, setResult] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/x-costs/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participants,
          followTasks,
          likeTasks,
          repostTasks,
          winnerCount,
        }),
      });
      setResult(res.ok ? await res.json() : null);
    } finally {
      setBusy(false);
    }
  }

  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <Card>
      <SectionTitle>Cost simulator</SectionTitle>
      <p className="mb-4 text-xs text-kos-muted">
        Estimate a raffle before launching it. Sweep-backed tasks (like, repost)
        cost far more than follows, because they price the post&rsquo;s whole
        engager list rather than one lookup.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setParticipants(n)}
            className={`rounded-lg border px-3 py-1 text-xs transition ${
              participants === n
                ? "border-kos-accent bg-kos-accent/10 text-kos-accent"
                : "border-kos-border text-kos-muted hover:text-white"
            }`}
          >
            {n.toLocaleString()}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Participants" value={participants} onChange={setParticipants} />
        <Field label="Follow tasks" value={followTasks} onChange={setFollowTasks} />
        <Field label="Like tasks" value={likeTasks} onChange={setLikeTasks} />
        <Field label="Repost tasks" value={repostTasks} onChange={setRepostTasks} />
        <Field label="Winners" value={winnerCount} onChange={setWinnerCount} />
      </div>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-kos-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? "Estimating…" : "Estimate cost"}
      </button>

      {result && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Estimated cost" value={usd(result.withCaching.estimatedCostUsd)} accent />
            <Metric label="Per participant" value={usd(result.withCaching.costPerParticipantUsd)} />
            <Metric label="API requests" value={result.withCaching.requests.toLocaleString()} />
          </div>

          <div className="rounded-xl border border-kos-border bg-kos-panel/50 p-4 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wide text-kos-muted">
              Breakdown
            </div>
            {result.withCaching.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-3 py-1">
                <span className="text-kos-muted">{line.label}</span>
                <span className="tabular-nums">
                  {line.requests.toLocaleString()} calls · {usd(line.estimatedCostUsd)}
                </span>
              </div>
            ))}
            <div className="mt-3 flex justify-between gap-3 border-t border-kos-border pt-3">
              <span className="text-kos-muted">Without caching</span>
              <span className="tabular-nums line-through opacity-60">
                {usd(result.withoutCaching.estimatedCostUsd)}
              </span>
            </div>
            <div className="flex justify-between gap-3 py-1">
              <span className="text-kos-muted">Estimated saving</span>
              <span className="tabular-nums text-emerald-400">
                {usd(result.estimatedSavingsUsd)}
              </span>
            </div>
          </div>

          <ul className="space-y-1 text-xs text-kos-muted">
            {result.assumptions.map((a) => (
              <li key={a}>— {a}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-kos-muted">
        Rates in use: user read {usd(pricing.USER_READ ?? 0)}, post read{" "}
        {usd(pricing.POST_READ ?? 0)}. Override with <code className="font-mono">X_PRICE_*</code>.
      </p>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-kos-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full rounded-lg border border-kos-border bg-kos-panel px-3 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-kos-border bg-kos-panel/50 px-4 py-3">
      <div className="text-xs text-kos-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-kos-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}
