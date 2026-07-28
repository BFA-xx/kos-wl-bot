"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import {
  Empty,
  PageTitle,
  SectionTitle,
  Segmented,
  StatCard,
  StatusBadge,
  TableShell,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { useCan } from "@/lib/org-context";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

interface GuildOption {
  id: string;
  name: string | null;
}

interface DiscordOption {
  id: string;
  name: string;
}

interface GuildMeta {
  channels: DiscordOption[];
  roles: DiscordOption[];
  hasBotToken: boolean;
  defaults?: { raidChannelId: string | null };
}

interface Raid {
  id: string;
  title: string;
  tweetUrls: string[];
  instructions: string;
  proofType: string;
  startPing: string;
  status: string;
  startAt: string;
  endAt: string;
  guildId: string;
  channelId: string;
  staffChannelId: string | null;
  rewardRoleId: string | null;
  rewardRoleName: string;
  participantLimit: number | null;
  allowMultipleSubmissions: boolean;
  announcementMessage: string | null;
  validParticipantCount: number;
  roleAssignmentCount: number;
  roleAssignmentFailedCount: number;
  failureReason: string | null;
  participantCount: number;
  submissionCount: number;
  submissionCounts: Record<string, number>;
  guild: GuildOption;
}

interface RaidSubmission {
  id: string;
  content: string | null;
  status: string;
  proofKind: string;
  createdAt: string;
  evidence: { reason?: string } | null;
  attachments: {
    id: string;
    fileName: string;
    contentType: string;
    byteLength: number;
  }[];
}

interface RaidParticipant {
  id: string;
  status: string;
  roleAssignedAt: string | null;
  roleAssignmentError: string | null;
  updatedAt: string;
  user: {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
  };
  submissions: RaidSubmission[];
}

interface RaidData {
  raids: Raid[];
  participants: RaidParticipant[] | null;
  guilds: GuildOption[];
  error?: string;
}

type View = "active" | "scheduled" | "completed";

interface RaidForm {
  id: string | null;
  guildId: string;
  title: string;
  tweetUrls: string;
  instructions: string;
  proofType: string;
  startPing: string;
  startAt: string;
  endAt: string;
  channelId: string;
  staffChannelId: string;
  rewardRoleId: string;
  rewardRoleName: string;
  participantLimit: string;
  allowMultipleSubmissions: boolean;
  announcementMessage: string;
}

const EMPTY_FORM: RaidForm = {
  id: null,
  guildId: "",
  title: "",
  tweetUrls: "",
  instructions: "",
  proofType: "AUTO",
  startPing: "everyone",
  startAt: "",
  endAt: "",
  channelId: "",
  staffChannelId: "",
  rewardRoleId: "",
  rewardRoleName: "",
  participantLimit: "",
  allowMultipleSubmissions: false,
  announcementMessage: "",
};

const VIEWS = [
  { key: "active", label: "Active" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
] as const;

export function RaidManager() {
  const { org } = useParams<{ org: string }>();
  const canCreate = useCan(PERMISSIONS.RAID_CREATE);
  const canEdit = useCan(PERMISSIONS.RAID_EDIT);
  const canExport = useCan(PERMISSIONS.RAID_EXPORT);
  const [view, setView] = useState<View>("active");
  const [selectedRaidId, setSelectedRaidId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RaidForm>(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const apiUrl = `/api/${org}/raids${
    selectedRaidId ? `?raidId=${encodeURIComponent(selectedRaidId)}` : ""
  }`;
  const { data, mutate } = useSWR<RaidData>(apiUrl, fetcher, {
    refreshInterval: 8_000,
  });
  const { data: meta } = useSWR<GuildMeta>(
    form.guildId ? `/api/${org}/guilds/${form.guildId}/meta` : null,
    fetcher,
  );
  const raids = data?.raids ?? [];
  const selectedRaid = raids.find((raid) => raid.id === selectedRaidId) ?? null;

  useEffect(() => {
    if (!form.guildId && data?.guilds[0]) {
      setForm((current) => ({
        ...current,
        guildId: data.guilds[0].id,
      }));
    }
  }, [data?.guilds, form.guildId]);

  useEffect(() => {
    if (form.guildId && !form.channelId && meta?.defaults?.raidChannelId) {
      setForm((current) => ({
        ...current,
        channelId: meta.defaults?.raidChannelId ?? "",
      }));
    }
  }, [form.channelId, form.guildId, meta?.defaults?.raidChannelId]);

  const stats = useMemo(
    () => ({
      active: raids.filter((raid) => raid.status === "LIVE").length,
      scheduled: raids.filter((raid) =>
        ["DRAFT", "SCHEDULED"].includes(raid.status),
      ).length,
      valid: raids.reduce((sum, raid) => sum + raid.validParticipantCount, 0),
      completed: raids.filter((raid) => raid.status === "ENDED").length,
    }),
    [raids],
  );

  const visible = raids.filter((raid) => {
    if (view === "active") return raid.status === "LIVE";
    if (view === "scheduled")
      return ["DRAFT", "SCHEDULED"].includes(raid.status);
    return ["ENDED", "CANCELLED"].includes(raid.status);
  });

  function newRaid() {
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    setForm({
      ...EMPTY_FORM,
      guildId: data?.guilds[0]?.id ?? "",
      startAt: toLocalInput(start),
      endAt: toLocalInput(end),
    });
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editRaid(raid: Raid) {
    setForm({
      id: raid.id,
      guildId: raid.guildId,
      title: raid.title,
      tweetUrls: raid.tweetUrls.join("\n"),
      instructions: raid.instructions,
      proofType: raid.proofType,
      startPing: raid.startPing,
      startAt: toLocalInput(raid.startAt),
      endAt: toLocalInput(raid.endAt),
      channelId: raid.channelId,
      staffChannelId: raid.staffChannelId ?? "",
      rewardRoleId: raid.rewardRoleId ?? "",
      rewardRoleName: raid.rewardRoleName,
      participantLimit: raid.participantLimit?.toString() ?? "",
      allowMultipleSubmissions: raid.allowMultipleSubmissions,
      announcementMessage: raid.announcementMessage ?? "",
    });
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent, publish: boolean) {
    event.preventDefault();
    setBusy(publish ? "publish" : "save");
    setMessage("");
    const payload = {
      ...form,
      tweetUrls: form.tweetUrls
        .split(/\s+/u)
        .map((url) => url.trim())
        .filter(Boolean),
      startAt: localInputToIso(form.startAt),
      endAt: localInputToIso(form.endAt),
      participantLimit: form.participantLimit || null,
      publish,
    };
    const response = await fetch(
      form.id ? `/api/${org}/raids/${form.id}` : `/api/${org}/raids`,
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Raid could not be saved.");
      return;
    }
    setMessage(
      publish
        ? "Raid queued for Discord."
        : form.id
          ? "Raid updated."
          : "Draft saved.",
    );
    setShowForm(false);
    setForm(EMPTY_FORM);
    setView("scheduled");
    await mutate();
  }

  async function action(
    raid: Raid,
    actionName: "publish" | "end" | "cancel" | "duplicate",
  ) {
    if (
      ["end", "cancel"].includes(actionName) &&
      !confirm(`${actionName === "end" ? "End" : "Cancel"} “${raid.title}”?`)
    )
      return;
    setBusy(`${actionName}:${raid.id}`);
    setMessage("");
    const duplicate = actionName === "duplicate";
    const response = await fetch(
      `/api/${org}/raids/${raid.id}${duplicate ? "/duplicate" : ""}`,
      {
        method: duplicate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: duplicate ? undefined : JSON.stringify({ action: actionName }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(
      response.ok
        ? duplicate
          ? "Raid duplicated as a draft."
          : `Raid ${actionName === "publish" ? "queued" : actionName === "end" ? "is ending" : "cancelled"}.`
        : (body.error ?? "Raid action failed."),
    );
    if (response.ok) {
      if (duplicate) setView("scheduled");
      await mutate();
    }
  }

  async function review(submission: RaidSubmission, status: string) {
    if (!selectedRaidId) return;
    setBusy(`review:${submission.id}`);
    const response = await fetch(
      `/api/${org}/raids/${selectedRaidId}/submissions/${submission.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(
      response.ok
        ? "Submission status updated."
        : (body.error ?? "Review failed."),
    );
    if (response.ok) await mutate();
  }

  return (
    <>
      <PageTitle
        title="Raids"
        subtitle="Run engagement raids, collect proof in Discord, verify participation, and reward valid members automatically."
        action={
          canCreate ? (
            <button className="kos-btn-primary" onClick={newRaid}>
              + New raid
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard accent label="Live raids" value={stats.active} />
        <StatCard label="Scheduled & drafts" value={stats.scheduled} />
        <StatCard label="Valid participants" value={stats.valid} />
        <StatCard label="Completed raids" value={stats.completed} />
      </div>

      {showForm ? (
        <RaidComposer
          form={form}
          setForm={setForm}
          guilds={data?.guilds ?? []}
          meta={meta}
          busy={busy}
          onSave={save}
          onClose={() => {
            setShowForm(false);
            setForm(EMPTY_FORM);
          }}
        />
      ) : null}

      {message ? (
        <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-kos-muted">
          {message}
        </div>
      ) : null}

      {data?.error ? (
        <Empty>{data.error}</Empty>
      ) : !data ? (
        <Empty>Loading raids…</Empty>
      ) : data.guilds.length === 0 ? (
        <Empty>Connect a Discord server before creating a raid.</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented options={[...VIEWS]} value={view} onChange={setView} />
            <span className="text-xs text-kos-muted">
              Proof links are shape-verified under KOS&apos;s current X
              attestation policy.
            </span>
          </div>
          {visible.length === 0 ? (
            <Empty>No {view} raids yet.</Empty>
          ) : (
            <div className="grid gap-4">
              {visible.map((raid) => (
                <RaidCard
                  key={raid.id}
                  raid={raid}
                  org={org}
                  busy={busy}
                  canCreate={canCreate}
                  canEdit={canEdit}
                  canExport={canExport}
                  selected={selectedRaidId === raid.id}
                  onEdit={() => editRaid(raid)}
                  onAction={(name) => action(raid, name)}
                  onParticipants={() =>
                    setSelectedRaidId((current) =>
                      current === raid.id ? null : raid.id,
                    )
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {selectedRaid ? (
        <ParticipantPanel
          org={org}
          raid={selectedRaid}
          participants={data?.participants ?? []}
          canEdit={canEdit}
          busy={busy}
          onReview={review}
          onClose={() => setSelectedRaidId(null)}
        />
      ) : null}
    </>
  );
}

function RaidComposer({
  form,
  setForm,
  guilds,
  meta,
  busy,
  onSave,
  onClose,
}: {
  form: RaidForm;
  setForm: (form: RaidForm) => void;
  guilds: GuildOption[];
  meta?: GuildMeta;
  busy: string | null;
  onSave: (event: FormEvent, publish: boolean) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="kos-card mb-6 p-5 sm:p-6">
      <SectionTitle>{form.id ? "Edit raid" : "Create a raid"}</SectionTitle>
      <form
        onSubmit={(event) => void onSave(event, false)}
        className="space-y-5"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Raid title">
            <input
              className="kos-input"
              value={form.title}
              maxLength={120}
              required
              placeholder="Community launch push"
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </Field>
          <Field label="Discord server">
            <select
              className="kos-input"
              value={form.guildId}
              onChange={(event) =>
                setForm({
                  ...form,
                  guildId: event.target.value,
                  channelId: "",
                  staffChannelId: "",
                  rewardRoleId: "",
                  rewardRoleName: "",
                })
              }
            >
              <option value="">Select server…</option>
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name ?? guild.id}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="X post URL">
          <textarea
            className="kos-input min-h-20"
            value={form.tweetUrls}
            required
            placeholder="https://x.com/community/status/..."
            onChange={(event) =>
              setForm({ ...form, tweetUrls: event.target.value })
            }
          />
          <Hint>
            One URL is typical. You can place up to five post URLs on separate
            lines for multi-post raids.
          </Hint>
        </Field>

        <Field label="Instructions">
          <textarea
            className="kos-input min-h-28"
            value={form.instructions}
            maxLength={1500}
            required
            placeholder="Like the post, leave a thoughtful comment, and submit your comment link in the raid thread."
            onChange={(event) =>
              setForm({ ...form, instructions: event.target.value })
            }
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Expected proof">
            <select
              className="kos-input"
              value={form.proofType}
              onChange={(event) =>
                setForm({ ...form, proofType: event.target.value })
              }
            >
              <option value="AUTO">Auto-detect from instructions</option>
              <option value="COMMENT">Comment link</option>
              <option value="QUOTE">Quote post link</option>
              <option value="REPOST">Repost link</option>
              <option value="IMAGE">Screenshot</option>
              <option value="ANY">Any recognized proof</option>
            </select>
          </Field>
          <Field label="Starts">
            <input
              className="kos-input"
              type="datetime-local"
              value={form.startAt}
              required
              onChange={(event) =>
                setForm({ ...form, startAt: event.target.value })
              }
            />
          </Field>
          <Field label="Ends">
            <input
              className="kos-input"
              type="datetime-local"
              value={form.endAt}
              required
              onChange={(event) =>
                setForm({ ...form, endAt: event.target.value })
              }
            />
          </Field>
          <Field label="Ping on start">
            <select
              className="kos-input"
              value={form.startPing}
              onChange={(event) =>
                setForm({ ...form, startPing: event.target.value })
              }
            >
              <option value="everyone">@everyone</option>
              <option value="here">@here</option>
              <option value="none">No ping</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ChannelField
            label="Raid channel"
            value={form.channelId}
            channels={meta?.channels ?? []}
            hasBotToken={meta?.hasBotToken ?? true}
            onChange={(channelId) => setForm({ ...form, channelId })}
          />
          <ChannelField
            label="Staff summary channel"
            value={form.staffChannelId}
            channels={meta?.channels ?? []}
            hasBotToken={meta?.hasBotToken ?? true}
            optional
            onChange={(staffChannelId) => setForm({ ...form, staffChannelId })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Reward role">
            <select
              className="kos-input"
              value={form.rewardRoleId}
              onChange={(event) => {
                const roleId = event.target.value;
                const role = meta?.roles.find((item) => item.id === roleId);
                setForm({
                  ...form,
                  rewardRoleId: roleId,
                  rewardRoleName: role?.name ?? "",
                });
              }}
            >
              <option value="">Create a new role…</option>
              {meta?.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  @{role.name}
                </option>
              ))}
            </select>
            {!form.rewardRoleId ? (
              <input
                className="kos-input mt-2"
                value={form.rewardRoleName}
                maxLength={100}
                required
                placeholder="Raid Participant"
                onChange={(event) =>
                  setForm({ ...form, rewardRoleName: event.target.value })
                }
              />
            ) : null}
            <Hint>
              KOS creates the role automatically when the named role does not
              exist.
            </Hint>
          </Field>
          <Field label="Participant limit">
            <input
              className="kos-input"
              type="number"
              min={1}
              max={1_000_000}
              value={form.participantLimit}
              placeholder="Unlimited"
              onChange={(event) =>
                setForm({ ...form, participantLimit: event.target.value })
              }
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-kos-muted">
              <input
                type="checkbox"
                checked={form.allowMultipleSubmissions}
                onChange={(event) =>
                  setForm({
                    ...form,
                    allowMultipleSubmissions: event.target.checked,
                  })
                }
              />
              Allow multiple valid submissions per member
            </label>
          </Field>
        </div>

        <Field label="Optional announcement message">
          <textarea
            className="kos-input min-h-20"
            value={form.announcementMessage}
            maxLength={1000}
            placeholder="Raid is live — bring the energy."
            onChange={(event) =>
              setForm({ ...form, announcementMessage: event.target.value })
            }
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button className="kos-btn" disabled={Boolean(busy)}>
            {busy === "save"
              ? "Saving…"
              : form.id
                ? "Save changes"
                : "Save draft"}
          </button>
          <button
            type="button"
            className="kos-btn-primary"
            disabled={Boolean(busy)}
            onClick={(event) => void onSave(event, true)}
          >
            {busy === "publish"
              ? "Queueing…"
              : form.id
                ? "Save & queue"
                : "Create & queue"}
          </button>
          <button
            type="button"
            className="kos-btn"
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

function RaidCard({
  raid,
  org,
  busy,
  canCreate,
  canEdit,
  canExport,
  selected,
  onEdit,
  onAction,
  onParticipants,
}: {
  raid: Raid;
  org: string;
  busy: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canExport: boolean;
  selected: boolean;
  onEdit: () => void;
  onAction: (action: "publish" | "end" | "cancel" | "duplicate") => void;
  onParticipants: () => void;
}) {
  return (
    <div className="kos-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{raid.title}</h2>
            <StatusBadge status={raid.status} />
          </div>
          <p className="mt-1 text-xs text-kos-muted">
            {raid.guild.name ?? raid.guildId} · {fmtDate(raid.startAt)} →{" "}
            {fmtDate(raid.endAt)}
          </p>
          <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-6 text-kos-muted">
            {raid.instructions}
          </p>
          {raid.failureReason ? (
            <p className="mt-2 text-sm text-rose-300">{raid.failureReason}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="kos-btn" onClick={onParticipants}>
            {selected ? "Hide participants" : "Participants"}
          </button>
          {canExport ? (
            <a className="kos-btn" href={`/api/${org}/raids/${raid.id}/export`}>
              Export
            </a>
          ) : null}
          {canEdit && ["DRAFT", "SCHEDULED", "LIVE"].includes(raid.status) ? (
            <button className="kos-btn" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {canEdit && raid.status === "DRAFT" ? (
            <button
              className="kos-btn-primary"
              disabled={busy === `publish:${raid.id}`}
              onClick={() => onAction("publish")}
            >
              Queue
            </button>
          ) : null}
          {canEdit && raid.status === "LIVE" ? (
            <button className="kos-btn" onClick={() => onAction("end")}>
              End now
            </button>
          ) : null}
          {canEdit && ["DRAFT", "SCHEDULED", "LIVE"].includes(raid.status) ? (
            <button className="kos-btn" onClick={() => onAction("cancel")}>
              Cancel
            </button>
          ) : null}
          {canCreate ? (
            <button className="kos-btn" onClick={() => onAction("duplicate")}>
              Duplicate
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-4 sm:grid-cols-5">
        <Metric label="Participants" value={raid.participantCount} />
        <Metric label="Valid" value={raid.validParticipantCount} />
        <Metric label="Invalid" value={raid.submissionCounts.INVALID ?? 0} />
        <Metric
          label="Duplicates"
          value={raid.submissionCounts.DUPLICATE ?? 0}
        />
        <Metric
          label="Roles assigned"
          value={`${raid.roleAssignmentCount}${
            raid.roleAssignmentFailedCount
              ? ` / ${raid.roleAssignmentFailedCount} failed`
              : ""
          }`}
        />
      </div>
    </div>
  );
}

function ParticipantPanel({
  org,
  raid,
  participants,
  canEdit,
  busy,
  onReview,
  onClose,
}: {
  org: string;
  raid: Raid;
  participants: RaidParticipant[];
  canEdit: boolean;
  busy: string | null;
  onReview: (submission: RaidSubmission, status: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="mt-6 kos-card p-5">
      <SectionTitle
        action={
          <button className="kos-btn" onClick={onClose}>
            Close
          </button>
        }
      >
        {raid.title} participants
      </SectionTitle>
      {participants.length === 0 ? (
        <Empty>No proof has been submitted yet.</Empty>
      ) : (
        <TableShell>
          <table className="kos-table">
            <thead>
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Latest proof</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Reward</th>
                <th className="px-4 py-3 text-right">Review</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => {
                const latest = participant.submissions[0];
                return (
                  <tr key={participant.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {participant.user.globalName ??
                          participant.user.username}
                      </div>
                      <div className="text-xs text-kos-muted">
                        {participant.user.id}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={participant.status} />
                      <div className="mt-1 text-[11px] text-kos-muted">
                        {participant.submissions.length} submission
                        {participant.submissions.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      {latest ? (
                        <>
                          <div className="text-xs font-medium">
                            {proofLabel(latest.proofKind)}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-kos-muted">
                            {latest.evidence?.reason ??
                              latest.content ??
                              "Attachment proof"}
                          </div>
                          {latest.attachments.length ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {latest.attachments.map((attachment) => (
                                <a
                                  key={attachment.id}
                                  className="kos-badge border-blue-400/30 text-blue-300"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/${org}/raids/${raid.id}/submissions/${latest.id}/attachments/${attachment.id}`}
                                >
                                  View {attachment.fileName}
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-kos-muted">
                      {fmtDate(latest?.createdAt ?? participant.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-kos-muted">
                      {participant.roleAssignedAt
                        ? `Assigned ${fmtDate(participant.roleAssignedAt)}`
                        : (participant.roleAssignmentError ?? "Not assigned")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && latest ? (
                        <select
                          className="kos-input ml-auto max-w-32"
                          value={latest.status}
                          disabled={busy === `review:${latest.id}`}
                          onChange={(event) =>
                            void onReview(latest, event.target.value)
                          }
                        >
                          <option value="PENDING">Pending</option>
                          <option value="VALID">Valid</option>
                          <option value="INVALID">Invalid</option>
                        </select>
                      ) : (
                        <StatusBadge
                          status={latest?.status ?? participant.status}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="kos-label">{label}</span>
      {children}
    </div>
  );
}

function ChannelField({
  label,
  value,
  channels,
  hasBotToken,
  optional,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  channels: DiscordOption[];
  hasBotToken: boolean;
  optional?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      {hasBotToken ? (
        <select
          className="kos-input"
          value={value}
          disabled={disabled}
          required={!optional}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {optional ? "Use raid/log channel" : "Select channel…"}
          </option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="kos-input"
          value={value}
          disabled={disabled}
          required={!optional}
          placeholder="Discord channel ID"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-kos-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs leading-5 text-kos-muted">{children}</p>;
}

function proofLabel(kind: string): string {
  return kind
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function toLocalInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
