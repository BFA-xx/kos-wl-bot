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
}

interface Ping {
  id: string;
  title: string;
  message: string;
  guildId: string;
  channelId: string;
  mentionMode: string;
  roleIds: string[];
  linkUrl: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  messageId: string | null;
  failureReason: string | null;
  createdAt: string;
  guild: GuildOption;
}

interface PingData {
  pings: Ping[];
  guilds: GuildOption[];
  error?: string;
}

interface PingForm {
  id: string | null;
  guildId: string;
  title: string;
  message: string;
  channelId: string;
  mentionMode: string;
  roleIds: string[];
  linkUrl: string;
  scheduledAt: string;
}

type View = "scheduled" | "drafts" | "history";

const EMPTY_FORM: PingForm = {
  id: null,
  guildId: "",
  title: "",
  message: "",
  channelId: "",
  mentionMode: "NONE",
  roleIds: [],
  linkUrl: "",
  scheduledAt: "",
};

const VIEWS = [
  { key: "scheduled", label: "Scheduled" },
  { key: "drafts", label: "Drafts" },
  { key: "history", label: "History" },
] as const;

export function PingManager() {
  const { org } = useParams<{ org: string }>();
  const canCreate = useCan(PERMISSIONS.PING_CREATE);
  const canEdit = useCan(PERMISSIONS.PING_EDIT);
  const { data, mutate } = useSWR<PingData>(`/api/${org}/pings`, fetcher, {
    refreshInterval: 8_000,
  });
  const [view, setView] = useState<View>("scheduled");
  const [form, setForm] = useState<PingForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { data: meta } = useSWR<GuildMeta>(
    form.guildId ? `/api/${org}/guilds/${form.guildId}/meta` : null,
    fetcher,
  );
  const pings = data?.pings ?? [];

  useEffect(() => {
    if (!form.guildId && data?.guilds[0]) {
      setForm((current) => ({ ...current, guildId: data.guilds[0].id }));
    }
  }, [data?.guilds, form.guildId]);

  const stats = useMemo(
    () => ({
      scheduled: pings.filter((ping) => ping.status === "SCHEDULED").length,
      sent: pings.filter((ping) => ping.status === "SENT").length,
      drafts: pings.filter((ping) => ping.status === "DRAFT").length,
      failed: pings.filter((ping) => ping.status === "FAILED").length,
    }),
    [pings],
  );

  const visible = pings.filter((ping) => {
    if (view === "scheduled")
      return ["SCHEDULED", "SENDING"].includes(ping.status);
    if (view === "drafts") return ["DRAFT", "FAILED"].includes(ping.status);
    return ["SENT", "CANCELLED"].includes(ping.status);
  });

  function newPing() {
    setForm({ ...EMPTY_FORM, guildId: data?.guilds[0]?.id ?? "" });
    setShowForm(true);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editPing(ping: Ping) {
    setForm({
      id: ping.id,
      guildId: ping.guildId,
      title: ping.title,
      message: ping.message,
      channelId: ping.channelId,
      mentionMode: ping.mentionMode,
      roleIds: ping.roleIds,
      linkUrl: ping.linkUrl ?? "",
      scheduledAt: ping.scheduledAt ? toLocalInput(ping.scheduledAt) : "",
    });
    setShowForm(true);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent, publish: boolean) {
    event.preventDefault();
    setBusy(publish ? "publish" : "save");
    setMessage("");
    const response = await fetch(
      form.id ? `/api/${org}/pings/${form.id}` : `/api/${org}/pings`,
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          scheduledAt: localInputToIso(form.scheduledAt),
          publish,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Ping could not be saved.");
      return;
    }
    setMessage(
      publish
        ? form.scheduledAt
          ? "Ping scheduled."
          : "Ping queued to send now."
        : form.id
          ? "Ping updated."
          : "Draft saved.",
    );
    setShowForm(false);
    setForm(EMPTY_FORM);
    setView(publish ? "scheduled" : "drafts");
    await mutate();
  }

  async function action(ping: Ping, name: "cancel" | "retry" | "duplicate") {
    if (name === "cancel" && !confirm(`Cancel “${ping.title}”?`)) return;
    setBusy(`${name}:${ping.id}`);
    setMessage("");
    const duplicate = name === "duplicate";
    const response = await fetch(
      `/api/${org}/pings/${ping.id}${duplicate ? "/duplicate" : ""}`,
      {
        method: duplicate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: duplicate ? undefined : JSON.stringify({ action: name }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(
      response.ok
        ? duplicate
          ? "Ping duplicated as a draft."
          : name === "retry"
            ? "Ping queued to retry."
            : "Ping cancelled."
        : (body.error ?? "Ping action failed."),
    );
    if (response.ok) {
      if (duplicate) setView("drafts");
      await mutate();
    }
  }

  return (
    <>
      <PageTitle
        title="Pings"
        subtitle="Compose, schedule, and track Discord announcements with controlled role, @here, or @everyone mentions."
        action={
          canCreate ? (
            <button className="kos-btn-primary" onClick={newPing}>
              + New ping
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard accent label="Scheduled" value={stats.scheduled} />
        <StatCard label="Sent" value={stats.sent} />
        <StatCard label="Drafts" value={stats.drafts} />
        <StatCard label="Failed" value={stats.failed} />
      </div>

      {showForm ? (
        <PingComposer
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
        <Empty>Loading pings…</Empty>
      ) : data.guilds.length === 0 ? (
        <Empty>Connect a Discord server before sending a ping.</Empty>
      ) : (
        <>
          <div className="mb-4">
            <Segmented options={[...VIEWS]} value={view} onChange={setView} />
          </div>
          {visible.length === 0 ? (
            <Empty>No {view} pings.</Empty>
          ) : (
            <TableShell>
              <table className="kos-table">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Ping</th>
                    <th className="px-4 py-3">Server</th>
                    <th className="px-4 py-3">Mention</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Delivery</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((ping) => (
                    <tr key={ping.id}>
                      <td className="max-w-md px-4 py-3">
                        <div className="font-medium">{ping.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-kos-muted">
                          {ping.message}
                        </div>
                        {ping.failureReason ? (
                          <div className="mt-1 text-xs text-rose-300">
                            {ping.failureReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-kos-muted">
                        {ping.guild.name ?? ping.guildId}
                      </td>
                      <td className="px-4 py-3 text-kos-muted">
                        {mentionLabel(ping)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={ping.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-kos-muted">
                        {ping.sentAt
                          ? fmtDate(ping.sentAt)
                          : ping.scheduledAt
                            ? fmtDate(ping.scheduledAt)
                            : "Not scheduled"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {canEdit &&
                          ["DRAFT", "SCHEDULED", "FAILED"].includes(
                            ping.status,
                          ) ? (
                            <button
                              className="kos-btn"
                              onClick={() => editPing(ping)}
                            >
                              Edit
                            </button>
                          ) : null}
                          {canEdit && ping.status === "FAILED" ? (
                            <button
                              className="kos-btn-primary"
                              disabled={busy === `retry:${ping.id}`}
                              onClick={() => void action(ping, "retry")}
                            >
                              Retry
                            </button>
                          ) : null}
                          {canEdit &&
                          ["DRAFT", "SCHEDULED", "FAILED"].includes(
                            ping.status,
                          ) ? (
                            <button
                              className="kos-btn"
                              onClick={() => void action(ping, "cancel")}
                            >
                              Cancel
                            </button>
                          ) : null}
                          {canCreate ? (
                            <button
                              className="kos-btn"
                              onClick={() => void action(ping, "duplicate")}
                            >
                              Duplicate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </>
      )}
    </>
  );
}

function PingComposer({
  form,
  setForm,
  guilds,
  meta,
  busy,
  onSave,
  onClose,
}: {
  form: PingForm;
  setForm: (form: PingForm) => void;
  guilds: GuildOption[];
  meta?: GuildMeta;
  busy: string | null;
  onSave: (event: FormEvent, publish: boolean) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="kos-card mb-6 p-5 sm:p-6">
      <SectionTitle>{form.id ? "Edit ping" : "Compose a ping"}</SectionTitle>
      <form
        onSubmit={(event) => void onSave(event, false)}
        className="space-y-5"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Ping title">
            <input
              className="kos-input"
              value={form.title}
              maxLength={120}
              required
              placeholder="Raid starts now"
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
                  roleIds: [],
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

        <Field label="Message">
          <textarea
            className="kos-input min-h-32"
            value={form.message}
            maxLength={4000}
            required
            placeholder="Jump into the raid thread and submit your proof before the timer ends."
            onChange={(event) =>
              setForm({ ...form, message: event.target.value })
            }
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Channel">
            {(meta?.hasBotToken ?? true) ? (
              <select
                className="kos-input"
                value={form.channelId}
                required
                onChange={(event) =>
                  setForm({ ...form, channelId: event.target.value })
                }
              >
                <option value="">Select channel…</option>
                {meta?.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="kos-input"
                value={form.channelId}
                required
                placeholder="Discord channel ID"
                onChange={(event) =>
                  setForm({ ...form, channelId: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Mention">
            <select
              className="kos-input"
              value={form.mentionMode}
              onChange={(event) =>
                setForm({
                  ...form,
                  mentionMode: event.target.value,
                  roleIds: event.target.value === "ROLES" ? form.roleIds : [],
                })
              }
            >
              <option value="NONE">No mention</option>
              <option value="HERE">@here</option>
              <option value="EVERYONE">@everyone</option>
              <option value="ROLES">Selected roles</option>
            </select>
          </Field>
          <Field label="Send time">
            <input
              className="kos-input"
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(event) =>
                setForm({ ...form, scheduledAt: event.target.value })
              }
            />
            <p className="mt-1 text-xs text-kos-muted">
              Leave empty to send immediately.
            </p>
          </Field>
        </div>

        {form.mentionMode === "ROLES" ? (
          <Field label="Roles to mention">
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 sm:grid-cols-2 lg:grid-cols-3">
              {meta?.roles.length ? (
                meta.roles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-center gap-2 text-sm text-kos-muted"
                  >
                    <input
                      type="checkbox"
                      checked={form.roleIds.includes(role.id)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          roleIds: event.target.checked
                            ? [...form.roleIds, role.id]
                            : form.roleIds.filter((id) => id !== role.id),
                        })
                      }
                    />
                    @{role.name}
                  </label>
                ))
              ) : (
                <span className="text-sm text-kos-muted">
                  No assignable roles found.
                </span>
              )}
            </div>
          </Field>
        ) : null}

        <Field label="Optional link">
          <input
            className="kos-input"
            type="url"
            value={form.linkUrl}
            placeholder="https://..."
            onChange={(event) =>
              setForm({ ...form, linkUrl: event.target.value })
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
              : form.scheduledAt
                ? "Schedule ping"
                : "Send now"}
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

function mentionLabel(ping: Ping): string {
  if (ping.mentionMode === "HERE") return "@here";
  if (ping.mentionMode === "EVERYONE") return "@everyone";
  if (ping.mentionMode === "ROLES")
    return `${ping.roleIds.length} role${ping.roleIds.length === 1 ? "" : "s"}`;
  return "None";
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
