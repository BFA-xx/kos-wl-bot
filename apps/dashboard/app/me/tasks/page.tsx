"use client";

import Link from "next/link";
import useSWR, { mutate as mutateKey } from "swr";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageTitle, Card, Empty } from "@/components/ui";
import { EntryPanel } from "@/components/EntryPanel";
import { fmtDate } from "@/lib/format";

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
interface RaffleSummary {
  id: number;
  org: { slug: string; name: string; logoUrl: string | null } | null;
  projectName: string;
  title: string;
  description: string | null;
  status: string;
  endAt: string;
  spots: number;
  entryCount: number | null;
  bannerUrl: string | null;
  entered: boolean;
  enteredAt: string | null;
  tasks: TaskRow[];
}
interface Data {
  raffle?: { id: number; projectName: string; title: string; status: string };
  raffles?: RaffleSummary[];
  xLinked: boolean;
  tasks?: TaskRow[];
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
    raffleId ? `/api/me/tasks?raffle=${raffleId}` : "/api/me/tasks",
    fetcher,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function complete(id: string, raffleIdForRefresh?: number) {
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
    await mutate();
    if (raffleIdForRefresh) void mutateKey(`/api/me/raffles/${raffleIdForRefresh}`);
  }

  if (!raffleId) {
    return (
      <TasksHub
        data={data}
        busy={busy}
        notes={notes}
        onComplete={complete}
      />
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

  const tasks = data?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "VERIFIED").length;
  const requiredLeft = tasks.filter((t) => t.required && t.status !== "VERIFIED").length;

  return (
    <>
      <PageTitle
        title={data?.raffle ? `${data.raffle.projectName}` : "Tasks"}
        subtitle={
          data?.raffle
            ? `${data.raffle.title} · complete the required tasks, then enter below.`
            : "Loading…"
        }
        action={
          <Link href="/me/tasks" className="kos-btn">
            All active raffles
          </Link>
        }
      />

      {data ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-kos-muted">
              <span className="text-lg font-semibold text-kos-fg">{done}</span> / {tasks.length} verified
            </div>
            {requiredLeft === 0 ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                All required tasks done — enter below 🎉
              </span>
            ) : (
              <span className="kos-badge border-amber-400/30 text-amber-400">
                {requiredLeft} required task{requiredLeft === 1 ? "" : "s"} left
              </span>
            )}
            {!data.xLinked && tasks.some((t) => t.type.startsWith("X_")) ? (
              <a href="/api/connect/x/start" className="kos-btn-primary">
                Link X account
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      {!data ? (
        <Empty>Loading…</Empty>
      ) : tasks.length === 0 ? (
        <Card className="text-sm text-kos-muted">
          This raffle has no verification tasks. Check the entry panel below for the remaining gates.
        </Card>
      ) : (
        <TaskList
          tasks={tasks}
          busy={busy}
          notes={notes}
          raffleId={data.raffle?.id}
          onComplete={complete}
        />
      )}

      {data?.raffle ? (
        <div className="mt-4">
          <EntryPanel raffleId={data.raffle.id} />
        </div>
      ) : null}
    </>
  );
}

function TasksHub({
  data,
  busy,
  notes,
  onComplete,
}: {
  data?: Data;
  busy: string | null;
  notes: Record<string, string>;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
}) {
  if (data?.error) {
    return (
      <>
        <PageTitle title="Tasks" subtitle="Active raffle tasks and web entry." />
        <Empty>{data.error}</Empty>
      </>
    );
  }

  const raffles = data?.raffles ?? [];
  const hasXTasks = raffles.some((r) => r.tasks.some((t) => t.type.startsWith("X_")));

  return (
    <>
      <PageTitle
        title="Tasks"
        subtitle="Active raffles, verification tasks, and web entry in one place."
      />

      {!data ? (
        <Empty>Loading active raffles…</Empty>
      ) : (
        <>
          {!data.xLinked && hasXTasks ? (
            <Card className="mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Link X to verify social tasks</div>
                  <div className="mt-0.5 text-sm text-kos-muted">
                    Link once, then verify X tasks across every KOS community.
                  </div>
                </div>
                <a href="/api/connect/x/start" className="kos-btn-primary">
                  Link X account
                </a>
              </div>
            </Card>
          ) : null}

          {raffles.length === 0 ? (
            <Empty>No active raffles right now. When communities go live, their tasks will show here.</Empty>
          ) : (
            <div className="space-y-4">
              {raffles.map((raffle) => (
                <RaffleTaskCard
                  key={raffle.id}
                  raffle={raffle}
                  busy={busy}
                  notes={notes}
                  onComplete={onComplete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function RaffleTaskCard({
  raffle,
  busy,
  notes,
  onComplete,
}: {
  raffle: RaffleSummary;
  busy: string | null;
  notes: Record<string, string>;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
}) {
  const done = raffle.tasks.filter((t) => t.status === "VERIFIED").length;
  const requiredLeft = raffle.tasks.filter((t) => t.required && t.status !== "VERIFIED").length;
  const publicHref = raffle.org ? `/c/${raffle.org.slug}/raffles/${raffle.id}` : "#";

  return (
    <div className="overflow-hidden rounded-2xl border border-kos-border bg-kos-card shadow-sm">
      {raffle.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={raffle.bannerUrl} alt="" className="h-36 w-full object-cover sm:h-44" />
      ) : null}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {raffle.org ? (
              <div className="mb-2 flex items-center gap-2 text-xs text-kos-muted">
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg bg-kos-fg text-[9px] font-black text-kos-bg">
                  {raffle.org.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={raffle.org.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    raffle.org.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                {raffle.org.name}
              </div>
            ) : null}
            <h2 className="truncate text-lg font-semibold">{raffle.projectName}</h2>
            <p className="mt-0.5 text-sm text-kos-muted">{raffle.title}</p>
            {raffle.description ? (
              <p className="mt-2 line-clamp-2 text-sm text-kos-muted">{raffle.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <span className="kos-badge border-emerald-400/30 text-emerald-400">LIVE</span>
            {raffle.entered ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">entered</span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Ends" value={fmtDate(raffle.endAt)} />
          <MiniStat label="Entries" value={raffle.entryCount === null ? "—" : raffle.entryCount} />
          <MiniStat label="Spots" value={raffle.spots} />
        </div>

        <div className="mt-4 rounded-xl border border-kos-border bg-kos-bg/35 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Verification tasks</div>
              <div className="text-xs text-kos-muted">
                {done} / {raffle.tasks.length} verified
                {requiredLeft > 0
                  ? ` · ${requiredLeft} required left`
                  : raffle.tasks.length > 0
                    ? " · ready for the entry check"
                    : ""}
              </div>
            </div>
            <Link href={`/me/tasks?raffle=${raffle.id}`} className="kos-btn text-xs">
              Focus view
            </Link>
          </div>
          {raffle.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-kos-border p-3 text-sm text-kos-muted">
              No verification tasks attached. Use the entry checklist below for the remaining gates.
            </p>
          ) : (
            <TaskList
              tasks={raffle.tasks}
              busy={busy}
              notes={notes}
              raffleId={raffle.id}
              compact
              onComplete={onComplete}
            />
          )}
        </div>

        <div className="mt-4">
          <EntryPanel raffleId={raffle.id} />
        </div>

        {raffle.org ? (
          <div className="mt-3 text-right">
            <Link href={publicHref} className="text-xs text-kos-muted underline-offset-2 hover:text-kos-fg hover:underline">
              View public raffle page →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  busy,
  notes,
  raffleId,
  compact = false,
  onComplete,
}: {
  tasks: TaskRow[];
  busy: string | null;
  notes: Record<string, string>;
  raffleId?: number;
  compact?: boolean;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const chip = STATUS_CHIP[t.status] ?? STATUS_CHIP.NOT_STARTED;
        return (
          <div
            key={t.id}
            className={
              compact
                ? "rounded-xl border border-kos-border bg-kos-panel/60 p-3"
                : "kos-card p-4"
            }
          >
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
                    onClick={() => onComplete(t.id, raffleId)}
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
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-kos-border bg-kos-panel p-3">
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-kos-muted">{label}</div>
    </div>
  );
}
