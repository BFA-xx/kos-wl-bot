"use client";

import useSWR from "swr";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageTitle, Card, Empty } from "@/components/ui";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TaskRow {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  description: string | null;
  required: boolean;
  points: number;
  actionUrl: string | null;
  status: string;
}
interface Data {
  raffle: { id: number; projectName: string; title: string; status: string };
  xLinked: boolean;
  tasks: TaskRow[];
  error?: string;
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: "Verified ✓", cls: "border-emerald-400/30 text-emerald-400" },
  NEEDS_REVIEW: { label: "In review", cls: "border-amber-400/30 text-amber-400" },
  PENDING: { label: "Not verified", cls: "border-kos-border text-kos-muted" },
  REJECTED: { label: "Rejected", cls: "border-red-500/30 text-red-400" },
  NOT_STARTED: { label: "To do", cls: "border-kos-border text-kos-muted" },
};

export default function MeTasksPage() {
  return (
    <Suspense fallback={<Empty>Loading…</Empty>}>
      <TasksInner />
    </Suspense>
  );
}

function TasksInner() {
  const params = useSearchParams();
  const raffleId = params.get("raffle");
  const { data, mutate } = useSWR<Data>(
    raffleId ? `/api/me/tasks?raffle=${raffleId}` : null,
    fetcher,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function complete(id: string) {
    setBusy(id);
    const res = await fetch(`/api/me/tasks/${id}/complete`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (body.action === "link_x") {
      setNotes((n) => ({ ...n, [id]: body.reason ?? "Link your X account first." }));
    } else if (body.reason) {
      setNotes((n) => ({ ...n, [id]: body.reason }));
    } else {
      setNotes((n) => ({ ...n, [id]: "" }));
    }
    mutate();
  }

  if (!raffleId) {
    return (
      <>
        <PageTitle title="Tasks" subtitle="Verification tasks for raffles and campaigns." />
        <Empty>Open this page from a raffle to see its tasks.</Empty>
      </>
    );
  }
  if (data?.error) {
    return (
      <>
        <PageTitle title="Tasks" subtitle="Verification tasks." />
        <Empty>{data.error}</Empty>
      </>
    );
  }

  const done = data?.tasks.filter((t) => t.status === "VERIFIED").length ?? 0;
  const requiredLeft =
    data?.tasks.filter((t) => t.required && t.status !== "VERIFIED").length ?? 0;

  return (
    <>
      <PageTitle
        title={data ? `${data.raffle.projectName}` : "Tasks"}
        subtitle={
          data
            ? `${data.raffle.title} · complete the required tasks, then enter in Discord.`
            : "Loading…"
        }
      />

      {data ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-kos-muted">
              <span className="text-lg font-semibold text-kos-fg">{done}</span> / {data.tasks.length} verified
            </div>
            {requiredLeft === 0 ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                All required tasks done — go enter the raffle in Discord 🎉
              </span>
            ) : (
              <span className="kos-badge border-amber-400/30 text-amber-400">
                {requiredLeft} required task{requiredLeft === 1 ? "" : "s"} left
              </span>
            )}
            {!data.xLinked && data.tasks.some((t) => t.type.startsWith("X_")) ? (
              <a href="/api/connect/x/start" className="kos-btn-primary">
                Link X account
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      {!data ? (
        <Empty>Loading…</Empty>
      ) : data.tasks.length === 0 ? (
        <Empty>This raffle has no verification tasks.</Empty>
      ) : (
        <div className="space-y-2">
          {data.tasks.map((t) => {
            const chip = STATUS_CHIP[t.status] ?? STATUS_CHIP.NOT_STARTED;
            return (
              <div key={t.id} className="kos-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.title}</span>
                      <span className={`kos-badge ${chip.cls}`}>{chip.label}</span>
                      {t.required ? (
                        <span className="kos-badge border-kos-border text-kos-muted">required</span>
                      ) : null}
                      {t.points > 0 ? (
                        <span className="kos-badge border-kos-border text-kos-muted">+{t.points} pts</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-kos-muted">
                      {t.typeLabel}
                      {t.description ? ` · ${t.description}` : ""}
                    </div>
                    {notes[t.id] ? (
                      <div className="mt-1 text-xs text-amber-400">{notes[t.id]}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {t.actionUrl ? (
                      <a href={t.actionUrl} target="_blank" rel="noreferrer" className="kos-btn">
                        Open ↗
                      </a>
                    ) : null}
                    {t.status !== "VERIFIED" && t.status !== "NEEDS_REVIEW" ? (
                      <button
                        onClick={() => complete(t.id)}
                        disabled={busy === t.id}
                        className="kos-btn-primary"
                      >
                        {busy === t.id ? "Checking…" : "Verify"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
