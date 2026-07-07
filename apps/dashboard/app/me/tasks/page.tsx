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
  kind?: "VERIFICATION" | "SOCIAL";
  type: string;
  typeLabel: string;
  title: string;
  description: string | null;
  required: boolean;
  points: number;
  actionUrl: string | null;
  status: string;
  verifiable?: boolean;
  requiresClick?: boolean;
  clicked?: boolean;
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
  ACTION_REQUIRED: { label: "Open step", cls: "border-sky-400/30 text-sky-400" },
  CLICKED: { label: "Ready to verify", cls: "border-amber-400/30 text-amber-400" },
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

  async function openTask(task: TaskRow, raffleIdForRefresh?: number) {
    if (task.actionUrl) window.open(task.actionUrl, "_blank", "noopener,noreferrer");
    if (!task.requiresClick || task.status === "VERIFIED") return;

    const res = await fetch(`/api/me/tasks/${task.id}/click`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setNotes((n) => ({ ...n, [task.id]: "" }));
      await mutate();
      if (raffleIdForRefresh) void mutateKey(`/api/me/raffles/${raffleIdForRefresh}`);
    } else {
      setNotes((n) => ({ ...n, [task.id]: body.error ?? "Couldn't record that click. Try again." }));
    }
  }

  if (!raffleId) {
    return (
      <TasksHub
        data={data}
        busy={busy}
        notes={notes}
        onComplete={complete}
        onOpen={openTask}
      />
    );
  }

  if (data?.error) {
    return (
      <>
        <PageTitle title="Tasks" subtitle="Raffle tasks." />
        <Empty>{data.error}</Empty>
      </>
    );
  }

  const tasks = data?.tasks ?? [];
  const summary = taskSummary(tasks);

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
              <span className="text-lg font-semibold text-kos-fg">{summary.verified}</span> / {summary.verifiable} verified
              {summary.social > 0 ? (
                <span className="ml-2">· {summary.social} raffle step{summary.social === 1 ? "" : "s"}</span>
              ) : null}
            </div>
            {summary.requiredLeft === 0 ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                {summary.social > 0 ? "All raffle steps verified — enter below 🎉" : "All required tasks done — enter below 🎉"}
              </span>
            ) : (
              <span className="kos-badge border-amber-400/30 text-amber-400">
                {summary.requiredLeft} required task{summary.requiredLeft === 1 ? "" : "s"} left
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
          This raffle has no raffle tasks. Check the entry panel below for the remaining gates.
        </Card>
      ) : (
        <TaskList
          tasks={tasks}
          busy={busy}
          notes={notes}
          raffleId={data.raffle?.id}
          onComplete={complete}
          onOpen={openTask}
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
  onOpen,
}: {
  data?: Data;
  busy: string | null;
  notes: Record<string, string>;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
  onOpen: (task: TaskRow, raffleIdForRefresh?: number) => void;
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
                  onOpen={onOpen}
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
  onOpen,
}: {
  raffle: RaffleSummary;
  busy: string | null;
  notes: Record<string, string>;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
  onOpen: (task: TaskRow, raffleIdForRefresh?: number) => void;
}) {
  const summary = taskSummary(raffle.tasks);
  const publicHref = raffle.org ? `/c/${raffle.org.slug}/raffles/${raffle.id}` : "#";

  return (
    <div className="overflow-hidden rounded-2xl border border-kos-border bg-kos-card shadow-sm">
      {raffle.bannerUrl ? <BannerFrame src={raffle.bannerUrl} /> : null}
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
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
            <h2 className="break-words text-lg font-semibold">{raffle.projectName}</h2>
            <p className="mt-0.5 text-sm text-kos-muted">{raffle.title}</p>
            {raffle.description ? (
              <p className="mt-2 line-clamp-2 text-sm text-kos-muted">{raffle.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <span className="kos-badge border-emerald-400/30 text-emerald-400">LIVE</span>
            {raffle.entered ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">entered</span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
          <MiniStat label="Ends" value={fmtDate(raffle.endAt)} />
          <MiniStat label="Entries" value={raffle.entryCount === null ? "—" : raffle.entryCount} />
          <MiniStat label="Spots" value={raffle.spots} />
        </div>

        <div className="mt-4 rounded-2xl border border-kos-border bg-kos-bg/35 p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Raffle tasks</div>
              <div className="text-xs text-kos-muted">
                {summary.verified} / {summary.verifiable} verified
                {summary.social > 0 ? ` · ${summary.social} raffle step${summary.social === 1 ? "" : "s"}` : ""}
                {summary.requiredLeft > 0
                  ? ` · ${summary.requiredLeft} required left`
                  : raffle.tasks.length > 0
                    ? " · ready for entry"
                    : ""}
              </div>
            </div>
            <Link href={`/me/tasks?raffle=${raffle.id}`} className="kos-btn text-center text-xs">
              Focus view
            </Link>
          </div>
          {raffle.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-kos-border p-3 text-sm text-kos-muted">
              No raffle tasks attached. Use the entry checklist below for the remaining gates.
            </p>
          ) : (
            <TaskList
              tasks={raffle.tasks}
              busy={busy}
              notes={notes}
              raffleId={raffle.id}
              compact
              onComplete={onComplete}
              onOpen={onOpen}
            />
          )}
        </div>

        <div className="mt-4">
          <EntryPanel raffleId={raffle.id} compact />
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
  onOpen,
}: {
  tasks: TaskRow[];
  busy: string | null;
  notes: Record<string, string>;
  raffleId?: number;
  compact?: boolean;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
  onOpen: (task: TaskRow, raffleIdForRefresh?: number) => void;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const chip = STATUS_CHIP[t.status] ?? STATUS_CHIP.NOT_STARTED;
        const locked = Boolean(t.requiresClick && !t.clicked && t.status !== "VERIFIED");
        const isDone = t.status === "VERIFIED";
        const primaryLabel =
          isDone
            ? "Verified"
            : t.kind === "SOCIAL" && locked
              ? "Open task"
              : t.kind === "SOCIAL" && t.clicked
                ? "Verify"
                : "Verify";
        const helper =
          isDone
            ? "Done — this step is verified."
            : locked
              ? "Open the link first. Then come back and verify."
              : t.kind === "SOCIAL" && t.clicked
                ? "Link opened — verify once you've completed it."
                : t.description;
        return (
          <div
            key={t.id}
            className={
              compact
                ? "rounded-xl border border-kos-border bg-kos-panel/60 p-3 transition-colors hover:border-kos-fg/20"
                : "kos-card p-4"
            }
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 gap-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    isDone
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-400"
                      : t.status === "CLICKED"
                        ? "border-amber-400/30 bg-amber-500/10 text-amber-400"
                        : "border-kos-border bg-kos-bg text-kos-muted"
                  }`}
                >
                  {isDone ? "✓" : t.status === "CLICKED" ? "2" : "1"}
                </span>
                <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  {t.required ? (
                    <span className="kos-badge border-kos-border text-kos-muted">required</span>
                  ) : null}
                  <span className={`kos-badge ${chip.cls}`}>{chip.label}</span>
                  {t.points > 0 ? (
                    <span className="kos-badge border-kos-border text-kos-muted">+{t.points} pts</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-kos-muted">
                  {t.typeLabel}
                  {helper ? ` · ${helper}` : ""}
                </div>
                {notes[t.id] ? (
                  <div className="mt-1 text-xs text-amber-400">{notes[t.id]}</div>
                ) : null}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-36">
                {isDone ? (
                  <span className="kos-btn cursor-default text-center text-emerald-400">Verified ✓</span>
                ) : t.kind === "SOCIAL" && locked && t.actionUrl ? (
                  <button type="button" onClick={() => onOpen(t, raffleId)} className="kos-btn-primary text-center">
                    {primaryLabel}
                  </button>
                ) : t.verifiable !== false && t.status !== "NEEDS_REVIEW" ? (
                  <button
                    onClick={() => onComplete(t.id, raffleId)}
                    disabled={busy === t.id || locked}
                    className="kos-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === t.id ? "Checking…" : primaryLabel}
                  </button>
                ) : null}
                {t.kind !== "SOCIAL" && t.actionUrl && !isDone ? (
                  <button type="button" onClick={() => onOpen(t, raffleId)} className="kos-btn text-center">
                    Open ↗
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

function BannerFrame({ src }: { src: string }) {
  return (
    <div className="border-b border-kos-border bg-kos-panel/70 px-3 py-3 sm:px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="mx-auto block max-h-[240px] w-auto max-w-full rounded-xl object-contain"
      />
    </div>
  );
}

function taskSummary(tasks: TaskRow[]) {
  const verifiable = tasks.filter((t) => t.verifiable !== false);
  return {
    verifiable: verifiable.length,
    verified: verifiable.filter((t) => t.status === "VERIFIED").length,
    requiredLeft: verifiable.filter((t) => t.required && t.status !== "VERIFIED").length,
    social: tasks.filter((t) => t.kind === "SOCIAL").length,
  };
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-kos-border bg-kos-panel p-3">
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-kos-muted">{label}</div>
    </div>
  );
}
