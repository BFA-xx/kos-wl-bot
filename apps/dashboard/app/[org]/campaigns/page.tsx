"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Empty, PageTitle, SectionTitle, StatCard } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { useCan } from "@/lib/org-context";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

interface TaskOption {
  id: string;
  title: string;
  type: string;
  points: number;
  active: boolean;
}

interface RaffleOption {
  id: number;
  projectName: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
}

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startAt: string | null;
  endAt: string | null;
  completionPoints: number;
  enrollmentCount: number;
  completedCount: number;
  tasks: { id: string; title: string; active: boolean; required: boolean }[];
  raffles: {
    id: number;
    projectName: string;
    title: string;
    status: string;
    required: boolean;
  }[];
}

interface CampaignData {
  campaigns: Campaign[];
  tasks: TaskOption[];
  raffles: RaffleOption[];
  error?: string;
}

const EMPTY_FORM = {
  id: null as string | null,
  title: "",
  description: "",
  startAt: "",
  endAt: "",
  completionPoints: 0,
  taskIds: [] as string[],
  raffleIds: [] as number[],
};

export default function CampaignsPage() {
  const { org } = useParams<{ org: string }>();
  const canCreate = useCan(PERMISSIONS.CAMPAIGN_CREATE);
  const canEdit = useCan(PERMISSIONS.CAMPAIGN_EDIT);
  const { data, mutate } = useSWR<CampaignData>(
    `/api/${org}/campaigns`,
    fetcher,
    {
      refreshInterval: 15_000,
    },
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const stats = useMemo(() => {
    const campaigns = data?.campaigns ?? [];
    return {
      live: campaigns.filter((campaign) => campaign.status === "LIVE").length,
      members: campaigns.reduce(
        (sum, campaign) => sum + campaign.enrollmentCount,
        0,
      ),
      completed: campaigns.reduce(
        (sum, campaign) => sum + campaign.completedCount,
        0,
      ),
    };
  }, [data]);

  function toggleTask(id: string) {
    setForm((current) => ({
      ...current,
      taskIds: current.taskIds.includes(id)
        ? current.taskIds.filter((taskId) => taskId !== id)
        : [...current.taskIds, id],
    }));
  }

  function toggleRaffle(id: number) {
    setForm((current) => ({
      ...current,
      raffleIds: current.raffleIds.includes(id)
        ? current.raffleIds.filter((raffleId) => raffleId !== id)
        : [...current.raffleIds, id],
    }));
  }

  async function save(event: { preventDefault(): void }, publish: boolean) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setBusy(publish ? "publish" : "save");
    setMessage("");
    const url = form.id
      ? `/api/${org}/campaigns/${form.id}`
      : `/api/${org}/campaigns`;
    const response = await fetch(url, {
      method: form.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        startAt: localInputToIso(form.startAt),
        endAt: localInputToIso(form.endAt),
        publish,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Campaign could not be saved.");
      return;
    }
    if (publish && form.id) {
      await perform(form.id, "publish");
      return;
    }
    setMessage(
      form.id
        ? "Campaign updated."
        : publish
          ? "Campaign published."
          : "Draft saved.",
    );
    setForm(EMPTY_FORM);
    await mutate();
  }

  async function perform(
    id: string,
    action: "publish" | "end" | "cancel",
    reset = true,
  ) {
    if (
      (action === "end" || action === "cancel") &&
      !confirm(`${action === "end" ? "End" : "Cancel"} this campaign?`)
    )
      return;
    setBusy(`${action}:${id}`);
    setMessage("");
    const response = await fetch(`/api/${org}/campaigns/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(
      response.ok
        ? `Campaign ${action === "publish" ? "published" : action === "end" ? "ended" : "cancelled"}.`
        : (body.error ?? "Action failed."),
    );
    if (response.ok && reset) setForm(EMPTY_FORM);
    await mutate();
  }

  function edit(campaign: Campaign) {
    setForm({
      id: campaign.id,
      title: campaign.title,
      description: campaign.description ?? "",
      startAt: toLocalInput(campaign.startAt),
      endAt: toLocalInput(campaign.endAt),
      completionPoints: campaign.completionPoints,
      taskIds: campaign.tasks.map((task) => task.id),
      raffleIds: campaign.raffles.map((raffle) => raffle.id),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(campaign: Campaign) {
    if (!confirm(`Delete "${campaign.title}"?`)) return;
    setBusy(`delete:${campaign.id}`);
    const response = await fetch(`/api/${org}/campaigns/${campaign.id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(
      response.ok ? "Campaign deleted." : (body.error ?? "Delete failed."),
    );
    if (response.ok) await mutate();
  }

  return (
    <>
      <PageTitle
        title="Campaigns"
        subtitle="Bundle reusable quests and raffle participation into measurable member journeys."
      />

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatCard accent label="Live campaigns" value={stats.live} />
            <StatCard label="Member enrollments" value={stats.members} />
            <StatCard label="Completed journeys" value={stats.completed} />
          </div>

          {canCreate || (canEdit && form.id) ? (
            <div className="kos-card mb-6 p-5">
              <SectionTitle>
                {form.id ? "Edit campaign" : "Build a campaign"}
              </SectionTitle>
              <form
                onSubmit={(event) => save(event, false)}
                className="space-y-4"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="kos-label">Campaign title</span>
                    <input
                      className="kos-input"
                      value={form.title}
                      onChange={(event) =>
                        setForm({ ...form, title: event.target.value })
                      }
                      placeholder="Robinhood Summer Sprint"
                      maxLength={120}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="kos-label">Completion bonus</span>
                    <input
                      className="kos-input"
                      type="number"
                      min={0}
                      max={1_000_000}
                      value={form.completionPoints}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          completionPoints: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="kos-label">Description</span>
                  <textarea
                    className="kos-input min-h-24"
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    placeholder="Explain the journey and what members unlock."
                    maxLength={1000}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="kos-label">Starts</span>
                    <input
                      className="kos-input"
                      type="datetime-local"
                      value={form.startAt}
                      onChange={(event) =>
                        setForm({ ...form, startAt: event.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="kos-label">Ends</span>
                    <input
                      className="kos-input"
                      type="datetime-local"
                      value={form.endAt}
                      onChange={(event) =>
                        setForm({ ...form, endAt: event.target.value })
                      }
                    />
                  </label>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <StepPicker
                    title="Quest tasks"
                    empty="Create reusable Tasks first."
                  >
                    {(data?.tasks ?? []).map((task) => (
                      <label
                        key={task.id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-kos-border bg-kos-panel/40 p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={form.taskIds.includes(task.id)}
                          onChange={() => toggleTask(task.id)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {task.title}
                          </span>
                          <span className="text-xs text-kos-muted">
                            {task.type.replaceAll("_", " ")} · +{task.points}{" "}
                            task points{task.active ? "" : " · paused"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </StepPicker>
                  <StepPicker
                    title="Raffle participation"
                    empty="Create or publish a raffle first."
                  >
                    {(data?.raffles ?? []).map((raffle) => (
                      <label
                        key={raffle.id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-kos-border bg-kos-panel/40 p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={form.raffleIds.includes(raffle.id)}
                          onChange={() => toggleRaffle(raffle.id)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {raffle.projectName} · {raffle.title}
                          </span>
                          <span className="text-xs text-kos-muted">
                            #{raffle.id} · {raffle.status.toLowerCase()}
                          </span>
                        </span>
                      </label>
                    ))}
                  </StepPicker>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="kos-btn"
                    disabled={busy !== null || !form.title.trim()}
                  >
                    {busy === "save"
                      ? "Saving…"
                      : form.id
                        ? "Save changes"
                        : "Save draft"}
                  </button>
                  <button
                    type="button"
                    className="kos-btn-primary"
                    disabled={busy !== null || !form.title.trim()}
                    onClick={(event) => void save(event, true)}
                  >
                    {busy === "publish" ? "Publishing…" : "Publish"}
                  </button>
                  {form.id ? (
                    <button
                      type="button"
                      className="px-2 text-sm text-kos-muted"
                      onClick={() => setForm(EMPTY_FORM)}
                    >
                      Cancel editing
                    </button>
                  ) : null}
                  {message ? (
                    <span className="text-sm text-kos-muted">{message}</span>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          <SectionTitle>Campaign portfolio</SectionTitle>
          {!data ? (
            <Empty>Loading campaigns…</Empty>
          ) : data.campaigns.length === 0 ? (
            <Empty>
              Create a campaign to combine tasks and raffles into one member
              journey.
            </Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.campaigns.map((campaign) => (
                <article key={campaign.id} className="kos-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{campaign.title}</h2>
                      {campaign.description ? (
                        <p className="mt-1 line-clamp-3 text-sm leading-6 text-kos-muted">
                          {campaign.description}
                        </p>
                      ) : null}
                    </div>
                    <Status status={campaign.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                    <Metric
                      label="Steps"
                      value={campaign.tasks.length + campaign.raffles.length}
                    />
                    <Metric label="Joined" value={campaign.enrollmentCount} />
                    <Metric label="Finished" value={campaign.completedCount} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-kos-muted">
                    {campaign.startAt ? (
                      <span>Starts {fmtDate(campaign.startAt)}</span>
                    ) : (
                      <span>Starts immediately</span>
                    )}
                    <span>·</span>
                    {campaign.endAt ? (
                      <span>Ends {fmtDate(campaign.endAt)}</span>
                    ) : (
                      <span>No fixed end</span>
                    )}
                    {campaign.completionPoints > 0 ? (
                      <>
                        <span>·</span>
                        <span>
                          +{campaign.completionPoints} completion points
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {campaign.tasks.map((task) => (
                      <span
                        key={task.id}
                        className="kos-badge border-white/[0.08] text-kos-muted"
                      >
                        ✓ {task.title}
                      </span>
                    ))}
                    {campaign.raffles.map((raffle) => (
                      <span
                        key={raffle.id}
                        className="kos-badge border-blue-400/20 text-blue-300"
                      >
                        🎟 {raffle.projectName}
                      </span>
                    ))}
                  </div>
                  {canEdit ? (
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-kos-border pt-4">
                      {!["ENDED", "CANCELLED"].includes(campaign.status) ? (
                        <button
                          className="kos-btn text-xs"
                          onClick={() => edit(campaign)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {campaign.status === "DRAFT" ? (
                        <button
                          className="kos-btn-primary text-xs"
                          disabled={busy !== null}
                          onClick={() => perform(campaign.id, "publish")}
                        >
                          Publish
                        </button>
                      ) : null}
                      {["SCHEDULED", "LIVE"].includes(campaign.status) ? (
                        <button
                          className="kos-btn text-xs"
                          disabled={busy !== null}
                          onClick={() => perform(campaign.id, "end")}
                        >
                          End
                        </button>
                      ) : null}
                      {!["ENDED", "CANCELLED"].includes(campaign.status) ? (
                        <button
                          className="kos-btn text-xs"
                          disabled={busy !== null}
                          onClick={() => perform(campaign.id, "cancel")}
                        >
                          Cancel
                        </button>
                      ) : null}
                      {["DRAFT", "CANCELLED"].includes(campaign.status) &&
                      campaign.enrollmentCount === 0 ? (
                        <button
                          className="px-2 text-xs text-kos-muted hover:text-red-400"
                          disabled={busy !== null}
                          onClick={() => remove(campaign)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function StepPicker({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <fieldset>
      <legend className="kos-label mb-2">{title}</legend>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {hasChildren ? (
          children
        ) : (
          <div className="rounded-xl border border-dashed border-kos-border p-4 text-sm text-kos-muted">
            {empty}
          </div>
        )}
      </div>
    </fieldset>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2">
      <div className="font-semibold">{value}</div>
      <div className="text-[11px] text-kos-muted">{label}</div>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const cls =
    status === "LIVE"
      ? "border-emerald-400/30 text-emerald-400"
      : status === "SCHEDULED"
        ? "border-blue-400/30 text-blue-300"
        : status === "ENDED"
          ? "border-white/[0.08] text-kos-muted"
          : "border-amber-400/30 text-amber-400";
  return <span className={`kos-badge ${cls}`}>{status.toLowerCase()}</span>;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}
