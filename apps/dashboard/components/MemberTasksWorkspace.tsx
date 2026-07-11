"use client";

import Link from "next/link";
import useSWR, { mutate as mutateKey } from "swr";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageTitle, Card, Empty, SectionTitle, StatCard } from "@/components/ui";
import { EntryPanel } from "@/components/EntryPanel";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface TaskRow {
  id: string;
  kind?: "VERIFICATION" | "SOCIAL";
  source?: "STANDALONE" | "RAFFLE";
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
interface TaskOrg {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  guildId?: string | null;
}
interface TaskGroup {
  org: TaskOrg;
  balance: number;
  tasks: TaskRow[];
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
  taskGroups?: TaskGroup[];
  xLinked: boolean;
  tasks?: TaskRow[];
  error?: string;
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  VERIFIED: {
    label: "Verified ✓",
    cls: "border-emerald-400/30 text-emerald-400",
  },
  NEEDS_REVIEW: {
    label: "In review",
    cls: "border-amber-400/30 text-amber-400",
  },
  PENDING: { label: "Not verified", cls: "border-kos-border text-kos-muted" },
  REJECTED: { label: "Rejected", cls: "border-red-500/30 text-red-400" },
  NOT_STARTED: { label: "To do", cls: "border-kos-border text-kos-muted" },
  ACTION_REQUIRED: {
    label: "Open step",
    cls: "border-sky-400/30 text-sky-400",
  },
  CLICKED: {
    label: "Ready to verify",
    cls: "border-amber-400/30 text-amber-400",
  },
};

export function MemberTasksWorkspace({
  embedded = false,
  showRaffleTasks = true,
  allowRaffleFocus = true,
}: {
  embedded?: boolean;
  showRaffleTasks?: boolean;
  allowRaffleFocus?: boolean;
}) {
  return (
    <Suspense fallback={<Empty>Loading…</Empty>}>
      <TasksInner
        embedded={embedded}
        showRaffleTasks={showRaffleTasks}
        allowRaffleFocus={allowRaffleFocus}
      />
    </Suspense>
  );
}

function TasksInner({
  embedded = false,
  showRaffleTasks,
  allowRaffleFocus,
}: {
  embedded?: boolean;
  showRaffleTasks: boolean;
  allowRaffleFocus: boolean;
}) {
  const params = useSearchParams();
  const raffleId = allowRaffleFocus ? params.get("raffle") : null;
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
      setNotes((n) => ({
        ...n,
        [id]: body.reason ?? "Link your X account first.",
      }));
    } else if (body.reason) {
      setNotes((n) => ({ ...n, [id]: body.reason }));
    } else {
      setNotes((n) => ({ ...n, [id]: "" }));
    }
    await mutate();
    if (raffleIdForRefresh)
      void mutateKey(`/api/me/raffles/${raffleIdForRefresh}`);
  }

  async function openTask(task: TaskRow, raffleIdForRefresh?: number) {
    if (task.actionUrl)
      window.open(task.actionUrl, "_blank", "noopener,noreferrer");
    if (!task.requiresClick || task.status === "VERIFIED") return;

    const res = await fetch(`/api/me/tasks/${task.id}/click`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setNotes((n) => ({ ...n, [task.id]: "" }));
      await mutate();
      if (raffleIdForRefresh)
        void mutateKey(`/api/me/raffles/${raffleIdForRefresh}`);
    } else {
      setNotes((n) => ({
        ...n,
        [task.id]: body.error ?? "Couldn't record that click. Try again.",
      }));
    }
  }

  if (!raffleId) {
    return (
      <TasksHub
        data={data}
        busy={busy}
        notes={notes}
        embedded={embedded}
        showRaffleTasks={showRaffleTasks}
        onComplete={complete}
        onOpen={openTask}
      />
    );
  }

  if (data?.error) {
    return (
      <>
        {!embedded ? <PageTitle title="Tasks" subtitle="Raffle tasks." /> : null}
        <Empty>{data.error}</Empty>
      </>
    );
  }

  const tasks = data?.tasks ?? [];
  const summary = taskSummary(tasks);

  return (
    <>
      {embedded ? (
        <SectionTitle>
          {data?.raffle ? `${data.raffle.projectName} tasks` : "Raffle tasks"}
        </SectionTitle>
      ) : (
        <PageTitle
          title={data?.raffle ? `${data.raffle.projectName}` : "Tasks"}
          subtitle={
            data?.raffle
              ? `${data.raffle.title} · complete the required tasks, then enter below.`
              : "Loading…"
          }
          action={
            <Link href="/me/points" className="kos-btn">
              All earning tasks
            </Link>
          }
        />
      )}

      {data ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-kos-muted">
              <span className="text-lg font-semibold text-kos-fg">
                {summary.verified}
              </span>{" "}
              / {summary.verifiable} verified
              {summary.social > 0 ? (
                <span className="ml-2">
                  · {summary.social} raffle step
                  {summary.social === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {summary.requiredLeft === 0 ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                {summary.social > 0
                  ? "All raffle steps verified — enter below 🎉"
                  : "All required tasks done — enter below 🎉"}
              </span>
            ) : (
              <span className="kos-badge border-amber-400/30 text-amber-400">
                {summary.requiredLeft} required task
                {summary.requiredLeft === 1 ? "" : "s"} left
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
          This raffle has no raffle tasks. Check the entry panel below for the
          remaining gates.
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
  embedded,
  showRaffleTasks,
  onComplete,
  onOpen,
}: {
  data?: Data;
  busy: string | null;
  notes: Record<string, string>;
  embedded: boolean;
  showRaffleTasks: boolean;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
  onOpen: (task: TaskRow, raffleIdForRefresh?: number) => void;
}) {
  if (data?.error) {
    return (
      <>
        {!embedded ? (
          <PageTitle
            title="Tasks"
            subtitle="Standalone earning tasks, active raffle tasks, and web entry."
          />
        ) : null}
        <Empty>{data.error}</Empty>
      </>
    );
  }

  const taskGroups = data?.taskGroups ?? [];
  const raffles = data?.raffles ?? [];
  const standaloneTasks = taskGroups.flatMap((group) => group.tasks);
  const raffleTasks = showRaffleTasks ? raffles.flatMap((r) => r.tasks) : [];
  const hasXTasks = [...standaloneTasks, ...raffleTasks].some((t) =>
    t.type.startsWith("X_"),
  );
  const standaloneSummary = taskSummary(standaloneTasks);

  return (
    <>
      {!embedded ? (
        <PageTitle
          title="Tasks"
          subtitle="Complete standalone tasks to earn points. Raffle tasks live below when a community uses them for entry."
          action={
            <>
              <Link href="/me/points" className="kos-btn">
                My points
              </Link>
              <Link href="/me/rewards" className="kos-btn-primary">
                Rewards
              </Link>
            </>
          }
        />
      ) : null}

      {!data ? (
        <Empty>Loading tasks…</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard
              accent
              label="Available earning tasks"
              value={standaloneTasks.length}
            />
            <StatCard
              label="Verified"
              value={`${standaloneSummary.verified}/${standaloneSummary.verifiable}`}
            />
            <StatCard
              label={showRaffleTasks ? "Live raffle workspaces" : "Communities"}
              value={showRaffleTasks ? raffles.length : taskGroups.length}
            />
          </div>

          {!data.xLinked && hasXTasks ? (
            <Card className="mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    Link X to verify social tasks
                  </div>
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

          <div
            className={
              showRaffleTasks
                ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]"
                : "grid gap-6"
            }
          >
            <section>
              <SectionTitle>Standalone earning tasks</SectionTitle>
              {taskGroups.length === 0 ? (
                <Empty>
                  No standalone earning tasks are live yet. When a community
                  creates a task with points, it will appear here immediately.
                </Empty>
              ) : (
                <div className="space-y-4">
                  {taskGroups.map((group) => (
                    <StandaloneTaskGroupCard
                      key={group.org.id}
                      group={group}
                      busy={busy}
                      notes={notes}
                      onComplete={onComplete}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              )}
            </section>

            {showRaffleTasks ? (
              <section>
                <SectionTitle>Raffle task workspaces</SectionTitle>
                {raffles.length === 0 ? (
                  <Empty>
                    No active raffles right now. When communities go live, their
                    raffle entry tasks will show here.
                  </Empty>
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
              </section>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

function StandaloneTaskGroupCard({
  group,
  busy,
  notes,
  onComplete,
  onOpen,
}: {
  group: TaskGroup;
  busy: string | null;
  notes: Record<string, string>;
  onComplete: (id: string, raffleIdForRefresh?: number) => void;
  onOpen: (task: TaskRow, raffleIdForRefresh?: number) => void;
}) {
  const summary = taskSummary(group.tasks);
  const potentialPoints = group.tasks
    .filter((task) => task.status !== "VERIFIED")
    .reduce((sum, task) => sum + task.points, 0);

  return (
    <div className="kos-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <CommunityAvatar org={group.org} />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">
              {group.org.name}
            </div>
            <div className="mt-1 text-xs text-kos-muted">
              {summary.verified}/{summary.verifiable} verified · current balance{" "}
              <span className="font-semibold text-kos-fg">{group.balance}</span>{" "}
              pts
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <span className="kos-badge border-blue-400/20 text-blue-300">
            +{potentialPoints} available pts
          </span>
          <Link href={`/c/${group.org.slug}`} className="kos-btn text-xs">
            Community
          </Link>
        </div>
      </div>

      <TaskList
        tasks={group.tasks}
        busy={busy}
        notes={notes}
        compact
        onComplete={onComplete}
        onOpen={onOpen}
      />
    </div>
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
  const publicHref = raffle.org
    ? `/r/${raffle.id}`
    : "#";

  return (
    <div className="kos-card overflow-hidden">
      {raffle.bannerUrl ? <BannerFrame src={raffle.bannerUrl} /> : null}
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {raffle.org ? (
              <div className="mb-2 flex items-center gap-2 text-xs text-kos-muted">
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg bg-kos-fg text-[9px] font-black text-kos-bg">
                  {raffle.org.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={raffle.org.logoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    raffle.org.name.slice(0, 2).toUpperCase()
                  )}
                </span>
                {raffle.org.name}
              </div>
            ) : null}
            <h2 className="break-words text-lg font-semibold">
              {raffle.projectName}
            </h2>
            <p className="mt-0.5 text-sm text-kos-muted">{raffle.title}</p>
            {raffle.description ? (
              <p className="mt-2 line-clamp-2 text-sm text-kos-muted">
                {raffle.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            <span className="kos-badge border-emerald-400/30 text-emerald-400">
              LIVE
            </span>
            {raffle.entered ? (
              <span className="kos-badge border-emerald-400/30 text-emerald-400">
                entered
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
          <MiniStat label="Ends" value={fmtDate(raffle.endAt)} />
          <MiniStat
            label="Entries"
            value={raffle.entryCount === null ? "—" : raffle.entryCount}
          />
          <MiniStat label="Spots" value={raffle.spots} />
        </div>

        <div className="mt-4 rounded-3xl border border-white/[0.08] bg-white/[0.025] p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] sm:p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Raffle tasks</div>
              <div className="text-xs text-kos-muted">
                {summary.verified} / {summary.verifiable} verified
                {summary.social > 0
                  ? ` · ${summary.social} raffle step${summary.social === 1 ? "" : "s"}`
                  : ""}
                {summary.requiredLeft > 0
                  ? ` · ${summary.requiredLeft} required left`
                  : raffle.tasks.length > 0
                    ? " · ready for entry"
                    : ""}
              </div>
            </div>
            <Link
              href={`/me/raffles?raffle=${raffle.id}`}
              className="kos-btn text-center text-xs"
            >
              Focus view
            </Link>
          </div>
          {raffle.tasks.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/[0.10] p-4 text-sm text-kos-muted">
              No raffle tasks attached. Use the entry checklist below for the
              remaining gates.
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
            <Link
              href={publicHref}
              className="text-xs text-kos-muted underline-offset-2 hover:text-kos-fg hover:underline"
            >
              View public raffle page →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommunityAvatar({ org }: { org: TaskOrg }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-kos-fg text-xs font-black text-kos-bg">
      {org.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={org.logoUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        org.name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

export function TaskList({
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
        const locked = Boolean(
          t.requiresClick && !t.clicked && t.status !== "VERIFIED",
        );
        const isDone = t.status === "VERIFIED";
        const primaryLabel = isDone
          ? "Verified"
          : t.kind === "SOCIAL" && locked
            ? "Open task"
            : t.kind === "SOCIAL" && t.clicked
              ? "Verify"
              : "Verify";
        const helper = isDone
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
                ? "rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition-colors hover:border-white/[0.16]"
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
                    <span className={`kos-badge ${chip.cls}`}>
                      {chip.label}
                    </span>
                    {t.required ? (
                      <span className="kos-badge border-white/[0.08] text-kos-muted">
                        required
                      </span>
                    ) : null}
                    {t.points > 0 ? (
                      <span className="kos-badge border-blue-400/20 text-blue-300">
                        +{t.points} pts
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-kos-muted">
                    {t.typeLabel}
                    {helper ? ` · ${helper}` : ""}
                  </div>
                  {notes[t.id] ? (
                    <div className="mt-1 text-xs text-amber-400">
                      {notes[t.id]}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-2 sm:w-40">
                {isDone ? (
                  <span className="kos-btn cursor-default text-center text-emerald-400">
                    Verified ✓
                  </span>
                ) : t.kind === "SOCIAL" && locked && t.actionUrl ? (
                  <button
                    type="button"
                    onClick={() => onOpen(t, raffleId)}
                    className="kos-btn-primary text-center"
                  >
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
                  <button
                    type="button"
                    onClick={() => onOpen(t, raffleId)}
                    className="kos-btn text-center"
                  >
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
    <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.14),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] px-3 py-3 sm:px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="mx-auto block max-h-[320px] w-auto max-w-full rounded-3xl object-contain shadow-2xl shadow-black/25"
      />
    </div>
  );
}

function taskSummary(tasks: TaskRow[]) {
  const verifiable = tasks.filter((t) => t.verifiable !== false);
  return {
    verifiable: verifiable.length,
    verified: verifiable.filter((t) => t.status === "VERIFIED").length,
    requiredLeft: verifiable.filter(
      (t) => t.required && t.status !== "VERIFIED",
    ).length,
    social: tasks.filter((t) => t.kind === "SOCIAL").length,
  };
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kos-metric p-3">
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-kos-muted">
        {label}
      </div>
    </div>
  );
}
