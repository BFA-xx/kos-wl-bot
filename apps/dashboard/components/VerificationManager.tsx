"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Empty, SectionTitle, TableShell } from "@/components/ui";
import { useCan, useOrg } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { colorToHex, VERIFICATION_DEFAULTS } from "@/lib/verification";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not load verification settings.");
  }
  return body;
};

interface ConnectedGuild {
  guildId: string;
  name: string;
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

interface VerificationSettings {
  enabled: boolean;
  verificationChannelId: string | null;
  rulesChannelId: string | null;
  logChannelId: string | null;
  unverifiedRoleId: string | null;
  allowedChannelIds: string[];
  defaultRoleIds: string[];
  welcomeTitle: string;
  welcomeDescription: string;
  welcomeColor: number;
  verifyButtonLabel: string;
  verifyButtonEmoji: string | null;
  modalTitle: string;
  modalFieldLabel: string;
  modalPlaceholder: string;
  requireCode: boolean;
  requireRulesAcceptance: boolean;
  preventCodeReuse: boolean;
  successMessage: string;
  failureMessage: string;
  panelMessageId: string | null;
  panelPublishedAt: string | null;
  desiredEnabled: boolean | null;
  accessCleanupRoleIds: string[];
  controlRequestId: string | null;
  controlRequestedAt: string | null;
  controlProcessedAt: string | null;
  controlError: string | null;
  updatedAt: string | null;
}

interface VerificationCodeRow {
  id: string;
  code: string;
  description: string | null;
  roleIds: string[];
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  active: boolean;
  oneTimePerMember: boolean;
  createdAt: string;
}

interface VerificationLogRow {
  id: string;
  userId: string;
  code: string | null;
  status: "SUCCESS" | "FAILURE";
  reason: string | null;
  roleIds: string[];
  rulesAcceptedAt: string | null;
  createdAt: string;
}

interface VerificationPayload {
  settings: VerificationSettings;
  codes: VerificationCodeRow[];
  logs: VerificationLogRow[];
  stats: {
    verifiedMembers: number;
    successes: number;
    failures: number;
  };
}

interface SettingsDraft {
  enabled: boolean;
  verificationChannelId: string;
  rulesChannelId: string;
  logChannelId: string;
  unverifiedRoleId: string;
  allowedChannelIds: string[];
  defaultRoleIds: string[];
  welcomeTitle: string;
  welcomeDescription: string;
  welcomeColor: string;
  verifyButtonLabel: string;
  verifyButtonEmoji: string;
  modalTitle: string;
  modalFieldLabel: string;
  modalPlaceholder: string;
  requireCode: boolean;
  requireRulesAcceptance: boolean;
  preventCodeReuse: boolean;
  successMessage: string;
  failureMessage: string;
}

interface CodeDraft {
  code: string;
  description: string;
  roleIds: string[];
  maxUses: string;
  expiresAt: string;
  active: boolean;
  oneTimePerMember: boolean;
}

type Tab = "setup" | "codes" | "activity";

const blankCode: CodeDraft = {
  code: "",
  description: "",
  roleIds: [],
  maxUses: "",
  expiresAt: "",
  active: true,
  oneTimePerMember: true,
};

export function VerificationManager() {
  const { slug } = useOrg();
  const canEdit = useCan(PERMISSIONS.SETTINGS_EDIT);
  const [tab, setTab] = useState<Tab>("setup");
  const [guildId, setGuildId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<VerificationCodeRow | null>(
    null,
  );
  const [codeDraft, setCodeDraft] = useState<CodeDraft>(blankCode);
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    settingsToDraft({
      ...VERIFICATION_DEFAULTS,
      updatedAt: null,
    }),
  );

  const { data: guildData, error: guildError } = useSWR<{
    connected: ConnectedGuild[];
  }>(`/api/${slug}/guilds`, fetcher);
  const connected = guildData?.connected ?? [];
  const effectiveGuildId = guildId || connected[0]?.guildId || "";
  const selectedGuild =
    connected.find((guild) => guild.guildId === effectiveGuildId) ?? null;
  const { data: meta } = useSWR<GuildMeta>(
    effectiveGuildId ? `/api/${slug}/guilds/${effectiveGuildId}/meta` : null,
    fetcher,
  );
  const { data, error, mutate, isLoading } = useSWR<VerificationPayload>(
    effectiveGuildId
      ? `/api/${slug}/verification?guildId=${effectiveGuildId}`
      : null,
    fetcher,
    { refreshInterval: 4_000 },
  );

  useEffect(() => {
    if (!guildId && connected[0]) setGuildId(connected[0].guildId);
  }, [connected, guildId]);

  useEffect(() => {
    if (!data?.settings) return;
    setDraft(settingsToDraft(data.settings));
  }, [
    effectiveGuildId,
    data?.settings.updatedAt,
    data?.settings.controlRequestId,
  ]);

  const roleNames = useMemo(
    () => new Map((meta?.roles ?? []).map((role) => [role.id, role.name])),
    [meta?.roles],
  );

  async function saveSettings(apply: boolean) {
    if (!effectiveGuildId) return;
    setBusy(apply ? "apply" : "save");
    setMessage(null);
    const response = await fetch(`/api/${slug}/verification`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: effectiveGuildId,
        ...settingsPayload(draft),
        ...(apply
          ? {
              desiredEnabled: draft.enabled,
              syncAccess: true,
              publishPanel: draft.enabled,
            }
          : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Could not save verification settings.");
      return;
    }
    setMessage(
      apply
        ? "Saved. KOS is applying Discord access and panel changes now."
        : "Verification draft saved.",
    );
    await mutate();
  }

  async function queueAction(action: "sync" | "publish") {
    if (!effectiveGuildId) return;
    setBusy(action);
    setMessage(null);
    const response = await fetch(`/api/${slug}/verification`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: effectiveGuildId,
        syncAccess: action === "sync",
        publishPanel: action === "publish",
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Could not queue that action.");
      return;
    }
    setMessage(
      action === "sync"
        ? "Access sync queued for the KOS bot."
        : "Verification panel publish queued for the KOS bot.",
    );
    await mutate();
  }

  function startCreateCode() {
    setEditingCode(null);
    setCodeDraft(blankCode);
    setMessage(null);
  }

  function startEditCode(code: VerificationCodeRow) {
    setEditingCode(code);
    setCodeDraft({
      code: code.code,
      description: code.description ?? "",
      roleIds: code.roleIds,
      maxUses: code.maxUses?.toString() ?? "",
      expiresAt: toDateTimeLocal(code.expiresAt),
      active: code.active,
      oneTimePerMember: code.oneTimePerMember,
    });
    setMessage(null);
  }

  async function saveCode(event: React.FormEvent) {
    event.preventDefault();
    if (!effectiveGuildId) return;
    setBusy("code");
    setMessage(null);
    const response = await fetch(
      editingCode
        ? `/api/${slug}/verification/codes/${editingCode.id}`
        : `/api/${slug}/verification/codes`,
      {
        method: editingCode ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guildId: effectiveGuildId,
          ...codeDraft,
          maxUses: codeDraft.maxUses || null,
          expiresAt: codeDraft.expiresAt
            ? new Date(codeDraft.expiresAt).toISOString()
            : null,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Could not save that verification code.");
      return;
    }
    setMessage(
      editingCode ? `${body.code.code} updated.` : `${body.code.code} created.`,
    );
    setEditingCode(null);
    setCodeDraft(blankCode);
    await mutate();
  }

  async function deleteCode(code: VerificationCodeRow) {
    if (
      !confirm(
        `Delete ${code.code}? Pending attempts will fail, but redemption history remains.`,
      )
    ) {
      return;
    }
    setBusy(`delete:${code.id}`);
    setMessage(null);
    const response = await fetch(`/api/${slug}/verification/codes/${code.id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Could not delete that verification code.");
      return;
    }
    if (editingCode?.id === code.id) startCreateCode();
    setMessage(`${code.code} deleted.`);
    await mutate();
  }

  if (guildError) return <Empty>{guildError.message}</Empty>;
  if (!guildData) return <Empty>Loading connected servers…</Empty>;
  if (connected.length === 0) {
    return (
      <Empty>
        Connect a Discord server before configuring member verification.
      </Empty>
    );
  }

  const settings = data?.settings;
  const pending = Boolean(settings?.controlRequestId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 flex-1">
          <label className="kos-label">Discord server</label>
          <select
            className="kos-input max-w-xl"
            value={effectiveGuildId}
            onChange={(event) => {
              setGuildId(event.target.value);
              setMessage(null);
              setEditingCode(null);
              setCodeDraft(blankCode);
            }}
          >
            {connected.map((guild) => (
              <option key={guild.guildId} value={guild.guildId}>
                {guild.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Metric value={data?.stats.verifiedMembers ?? "—"} label="Verified" />
          <Metric value={data?.stats.successes ?? "—"} label="Successes" />
          <Metric value={data?.stats.failures ?? "—"} label="Failures" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/[0.08] bg-white/[0.025] p-3">
        <div className="inline-flex rounded-2xl border border-white/[0.08] bg-black/20 p-1">
          {(
            [
              ["setup", "Setup"],
              [
                "codes",
                `Codes${data?.codes.length ? ` · ${data.codes.length}` : ""}`,
              ],
              ["activity", "Activity"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === key
                  ? "bg-white text-black shadow-sm"
                  : "text-kos-muted hover:bg-white/[0.04] hover:text-kos-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <StatusLine settings={settings} pending={pending} />
      </div>

      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : isLoading || !data ? (
        <Empty>Loading KOS verification…</Empty>
      ) : tab === "setup" ? (
        <SetupTab
          canEdit={canEdit}
          draft={draft}
          setDraft={setDraft}
          meta={meta}
          guildId={effectiveGuildId}
          settings={data.settings}
          busy={busy}
          onSave={saveSettings}
          onAction={queueAction}
        />
      ) : tab === "codes" ? (
        <CodesTab
          canEdit={canEdit}
          codes={data.codes}
          roles={meta?.roles ?? []}
          roleNames={roleNames}
          draft={codeDraft}
          setDraft={setCodeDraft}
          editing={editingCode}
          busy={busy}
          onSubmit={saveCode}
          onCreate={startCreateCode}
          onEdit={startEditCode}
          onDelete={deleteCode}
        />
      ) : (
        <ActivityTab logs={data.logs} roleNames={roleNames} />
      )}

      {message ? (
        <Notice
          tone={message.toLowerCase().includes("could not") ? "error" : "info"}
        >
          {message}
        </Notice>
      ) : null}
      {settings?.controlError ? (
        <Notice tone="error">
          <strong>Last Discord apply failed.</strong> {settings.controlError}
        </Notice>
      ) : null}
      {!canEdit ? (
        <Notice tone="info">
          You can review verification, codes, and activity. Settings permission
          is required to make changes.
        </Notice>
      ) : null}
      <p className="text-xs leading-5 text-kos-muted">
        Web changes are scoped to {selectedGuild?.name ?? "this server"}.
        Discord roles, permission overwrites, and panel messages are always
        applied by the KOS bot and normally complete within one scheduler tick.
      </p>
    </div>
  );
}

function SetupTab({
  canEdit,
  draft,
  setDraft,
  meta,
  guildId,
  settings,
  busy,
  onSave,
  onAction,
}: {
  canEdit: boolean;
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  meta?: GuildMeta;
  guildId: string;
  settings: VerificationSettings;
  busy: string | null;
  onSave: (apply: boolean) => void;
  onAction: (action: "sync" | "publish") => void;
}) {
  const channels = meta?.channels ?? [];
  const roles = meta?.roles ?? [];
  const set = <K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-4">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionTitle>Verification state</SectionTitle>
              <p className="text-sm text-kos-muted">
                New members receive Unverified and only see onboarding channels
                while this is enabled.
              </p>
            </div>
            <Toggle
              checked={draft.enabled}
              onChange={(checked) => set("enabled", checked)}
              label={draft.enabled ? "Enabled" : "Disabled"}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <ChannelSelect
              label="Verification channel"
              value={draft.verificationChannelId}
              onChange={(value) => set("verificationChannelId", value)}
              options={channels}
              disabled={!canEdit}
              emptyLabel="Select the panel channel"
            />
            <ChannelSelect
              label="Rules channel"
              value={draft.rulesChannelId}
              onChange={(value) => set("rulesChannelId", value)}
              options={channels}
              disabled={!canEdit}
              emptyLabel="No rules channel"
            />
            <ChannelSelect
              label="Verification log channel"
              value={draft.logChannelId}
              onChange={(value) => set("logChannelId", value)}
              options={channels}
              disabled={!canEdit}
              emptyLabel="Database logs only"
            />
            <RoleSelect
              label="Unverified role"
              value={draft.unverifiedRoleId}
              onChange={(value) => set("unverifiedRoleId", value)}
              options={roles}
              disabled={!canEdit}
              emptyLabel="Let KOS create Unverified"
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <MultiPicker
              label="Extra welcome channels"
              help="Channels visible before verification, in addition to Verify and Rules."
              options={channels}
              selected={draft.allowedChannelIds}
              onChange={(value) => set("allowedChannelIds", value)}
              max={50}
              disabled={!canEdit}
              prefix="#"
            />
            <MultiPicker
              label="Default verified roles"
              help="Every successful member receives these roles."
              options={roles}
              selected={draft.defaultRoleIds}
              onChange={(value) => set("defaultRoleIds", value)}
              max={10}
              disabled={!canEdit}
              prefix="@"
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <SectionTitle>Verification requirements</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <ToggleCard
              title="Require code"
              description="Open the private Discord modal before rules."
              checked={draft.requireCode}
              onChange={(value) => set("requireCode", value)}
              disabled={!canEdit}
            />
            <ToggleCard
              title="Require rules"
              description="Members must explicitly click I Agree."
              checked={draft.requireRulesAcceptance}
              onChange={(value) => set("requireRulesAcceptance", value)}
              disabled={!canEdit}
            />
            <ToggleCard
              title="Prevent reuse"
              description="Honor each code's one-use-per-member setting."
              checked={draft.preventCodeReuse}
              onChange={(value) => set("preventCodeReuse", value)}
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <SectionTitle>Welcome panel</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Embed title"
              value={draft.welcomeTitle}
              onChange={(value) => set("welcomeTitle", value)}
              maxLength={256}
              disabled={!canEdit}
            />
            <TextField
              label="Embed colour"
              type="color"
              value={draft.welcomeColor}
              onChange={(value) => set("welcomeColor", value)}
              disabled={!canEdit}
            />
            <TextField
              label="Verify button label"
              value={draft.verifyButtonLabel}
              onChange={(value) => set("verifyButtonLabel", value)}
              maxLength={80}
              disabled={!canEdit}
            />
            <TextField
              label="Verify button emoji"
              value={draft.verifyButtonEmoji}
              onChange={(value) => set("verifyButtonEmoji", value)}
              maxLength={100}
              placeholder="Optional · e.g. ✅"
              disabled={!canEdit}
            />
          </div>
          <TextArea
            label="Embed description"
            value={draft.welcomeDescription}
            onChange={(value) => set("welcomeDescription", value)}
            maxLength={4000}
            rows={4}
            disabled={!canEdit}
          />
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <SectionTitle>Private modal</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField
              label="Modal title"
              value={draft.modalTitle}
              onChange={(value) => set("modalTitle", value)}
              maxLength={45}
              disabled={!canEdit}
            />
            <TextField
              label="Field label"
              value={draft.modalFieldLabel}
              onChange={(value) => set("modalFieldLabel", value)}
              maxLength={45}
              disabled={!canEdit}
            />
            <TextField
              label="Placeholder"
              value={draft.modalPlaceholder}
              onChange={(value) => set("modalPlaceholder", value)}
              maxLength={100}
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <SectionTitle>Member messages</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea
              label="Success message"
              value={draft.successMessage}
              onChange={(value) => set("successMessage", value)}
              maxLength={1900}
              rows={3}
              disabled={!canEdit}
              help="Supports {user}, {server}, {code}, and {roles}."
            />
            <TextArea
              label="Failure message"
              value={draft.failureMessage}
              onChange={(value) => set("failureMessage", value)}
              maxLength={1900}
              rows={3}
              disabled={!canEdit}
            />
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="kos-btn-primary"
              disabled={Boolean(busy)}
              onClick={() => onSave(true)}
            >
              {busy === "apply" ? "Applying…" : "Save & apply"}
            </button>
            <button
              type="button"
              className="kos-btn"
              disabled={Boolean(busy)}
              onClick={() => onSave(false)}
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="kos-btn"
              disabled={Boolean(busy)}
              onClick={() => onAction("sync")}
            >
              {busy === "sync" ? "Syncing…" : "Sync channel access"}
            </button>
            <button
              type="button"
              className="kos-btn"
              disabled={Boolean(busy)}
              onClick={() => onAction("publish")}
            >
              {busy === "publish" ? "Publishing…" : "Publish panel"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <VerificationPreview draft={draft} />
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
          <SectionTitle>Discord delivery</SectionTitle>
          <dl className="space-y-3 text-sm">
            <StatusItem
              label="Active state"
              value={settings.enabled ? "Enabled" : "Disabled"}
            />
            <StatusItem
              label="Panel"
              value={
                settings.panelPublishedAt
                  ? `Published ${formatRelative(settings.panelPublishedAt)}`
                  : "Not published"
              }
            />
            <StatusItem
              label="Last apply"
              value={
                settings.controlProcessedAt
                  ? formatRelative(settings.controlProcessedAt)
                  : "No web action yet"
              }
            />
            <StatusItem
              label="Rules link"
              value={
                draft.rulesChannelId
                  ? `discord.com/channels/${guildId}/${draft.rulesChannelId}`
                  : "Not configured"
              }
            />
          </dl>
          {!meta?.hasBotToken ? (
            <p className="mt-4 text-xs leading-5 text-amber-300">
              Discord metadata is unavailable. The production bot token must be
              configured for visual channel and role pickers.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CodesTab({
  canEdit,
  codes,
  roles,
  roleNames,
  draft,
  setDraft,
  editing,
  busy,
  onSubmit,
  onCreate,
  onEdit,
  onDelete,
}: {
  canEdit: boolean;
  codes: VerificationCodeRow[];
  roles: DiscordOption[];
  roleNames: Map<string, string>;
  draft: CodeDraft;
  setDraft: React.Dispatch<React.SetStateAction<CodeDraft>>;
  editing: VerificationCodeRow | null;
  busy: string | null;
  onSubmit: (event: React.FormEvent) => void;
  onCreate: () => void;
  onEdit: (code: VerificationCodeRow) => void;
  onDelete: (code: VerificationCodeRow) => void;
}) {
  const set = <K extends keyof CodeDraft>(key: K, value: CodeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <form
        onSubmit={onSubmit}
        className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4"
      >
        <SectionTitle>
          {editing ? `Edit ${editing.code}` : "Create code"}
        </SectionTitle>
        <div className="space-y-3">
          <TextField
            label="Code"
            value={draft.code}
            onChange={(value) => set("code", value.toUpperCase())}
            maxLength={32}
            placeholder="ALPHA"
            disabled={!canEdit}
          />
          <TextArea
            label="Description"
            value={draft.description}
            onChange={(value) => set("description", value)}
            maxLength={500}
            rows={2}
            placeholder="Who this code is for"
            disabled={!canEdit}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Max uses"
              type="number"
              value={draft.maxUses}
              onChange={(value) => set("maxUses", value)}
              placeholder="Unlimited"
              disabled={!canEdit}
            />
            <TextField
              label="Expiration"
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(value) => set("expiresAt", value)}
              disabled={!canEdit}
            />
          </div>
          <MultiPicker
            label="Roles to grant"
            help="These are added on top of the server's default verified roles."
            options={roles}
            selected={draft.roleIds}
            onChange={(value) => set("roleIds", value)}
            max={10}
            disabled={!canEdit}
            prefix="@"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleCard
              title="Active"
              description="Inactive codes cannot start verification."
              checked={draft.active}
              onChange={(value) => set("active", value)}
              disabled={!canEdit}
            />
            <ToggleCard
              title="One use per member"
              description="Block repeat redemption by the same Discord member."
              checked={draft.oneTimePerMember}
              onChange={(value) => set("oneTimePerMember", value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        {canEdit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="kos-btn-primary"
              disabled={Boolean(busy) || !draft.code.trim()}
            >
              {busy === "code"
                ? "Saving…"
                : editing
                  ? "Update code"
                  : "Create code"}
            </button>
            {editing ? (
              <button type="button" className="kos-btn" onClick={onCreate}>
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
      </form>

      <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
        <SectionTitle>Access codes</SectionTitle>
        {codes.length === 0 ? (
          <Empty>
            No verification codes yet. Create ALPHA, PARTNER, OG, MINTOOR, or
            any server-specific access tier.
          </Empty>
        ) : (
          <div className="space-y-2">
            {codes.map((code) => {
              const status = codeStatus(code);
              return (
                <div
                  key={code.id}
                  className="rounded-2xl border border-white/[0.08] bg-black/10 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold tracking-wide">
                          {code.code}
                        </span>
                        <span
                          className={`kos-badge ${status === "Active" ? "border-emerald-400/20 text-emerald-300" : "text-kos-muted"}`}
                        >
                          {status}
                        </span>
                        <span className="kos-badge text-kos-muted">
                          {code.uses}/{code.maxUses ?? "∞"} uses
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-kos-muted">
                        {code.description ?? "No description"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-kos-muted">
                        {code.roleIds.length > 0 ? (
                          code.roleIds.map((roleId) => (
                            <span key={roleId} className="kos-badge">
                              @{roleNames.get(roleId) ?? roleId}
                            </span>
                          ))
                        ) : (
                          <span>Default roles only</span>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-kos-muted">
                        {code.expiresAt
                          ? `Expires ${new Date(code.expiresAt).toLocaleString()}`
                          : "Never expires"}
                        {" · "}
                        {code.oneTimePerMember
                          ? "one use per member"
                          : "repeat member use allowed"}
                      </p>
                    </div>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="kos-btn"
                          onClick={() => onEdit(code)}
                          disabled={Boolean(busy)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="kos-btn text-red-300"
                          onClick={() => onDelete(code)}
                          disabled={Boolean(busy)}
                        >
                          {busy === `delete:${code.id}`
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTab({
  logs,
  roleNames,
}: {
  logs: VerificationLogRow[];
  roleNames: Map<string, string>;
}) {
  if (logs.length === 0) {
    return (
      <Empty>
        Verification activity will appear here after members begin onboarding.
      </Empty>
    );
  }
  return (
    <TableShell>
      <table className="kos-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Result</th>
            <th>Code / roles</th>
            <th>Rules</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>
                <div className="font-mono text-xs">{log.userId}</div>
                {log.reason ? (
                  <div className="mt-1 max-w-sm text-xs text-kos-muted">
                    {log.reason}
                  </div>
                ) : null}
              </td>
              <td>
                <span
                  className={`kos-badge ${
                    log.status === "SUCCESS"
                      ? "border-emerald-400/20 text-emerald-300"
                      : "border-red-400/20 text-red-300"
                  }`}
                >
                  {log.status === "SUCCESS" ? "Verified" : "Failed"}
                </span>
              </td>
              <td>
                <div className="font-mono text-xs">{log.code ?? "No code"}</div>
                {log.roleIds.length > 0 ? (
                  <div className="mt-1 text-xs text-kos-muted">
                    {log.roleIds
                      .map((roleId) => `@${roleNames.get(roleId) ?? roleId}`)
                      .join(", ")}
                  </div>
                ) : null}
              </td>
              <td className="text-xs text-kos-muted">
                {log.rulesAcceptedAt
                  ? new Date(log.rulesAcceptedAt).toLocaleString()
                  : "Not required"}
              </td>
              <td className="whitespace-nowrap text-xs text-kos-muted">
                {new Date(log.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function VerificationPreview({ draft }: { draft: SettingsDraft }) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-[#313338] p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Live Discord preview
        </span>
        <span className="rounded-full bg-black/20 px-2 py-1 text-[10px] text-white/45">
          Ephemeral modal follows
        </span>
      </div>
      <div
        className="rounded border-l-4 bg-[#2b2d31] p-4 text-white"
        style={{ borderLeftColor: draft.welcomeColor }}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white/55">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-violet-500 text-[9px] font-bold">
            K
          </span>
          KOS
          <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[8px] uppercase text-white">
            App
          </span>
        </div>
        <h3 className="font-semibold">
          {draft.welcomeTitle || "Welcome to KOS."}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-white/75">
          {draft.welcomeDescription ||
            "Before accessing the server, verify yourself."}
        </p>
        <button
          type="button"
          className="mt-4 rounded bg-[#5865f2] px-4 py-2 text-sm font-medium text-white"
        >
          {draft.verifyButtonEmoji ? `${draft.verifyButtonEmoji} ` : ""}
          {draft.verifyButtonLabel || "Verify"}
        </button>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          {draft.modalTitle || "Verify Access"}
        </p>
        <p className="mt-2 text-xs font-medium text-white/70">
          {draft.modalFieldLabel || "Verification Code"}
        </p>
        <div className="mt-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/35">
          {draft.modalPlaceholder || "Enter your access code..."}
        </div>
      </div>
    </div>
  );
}

function ChannelSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: DiscordOption[];
  disabled: boolean;
  emptyLabel: string;
}) {
  return (
    <label className="block">
      <span className="kos-label">{label}</span>
      <select
        className="kos-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            #{option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: DiscordOption[];
  disabled: boolean;
  emptyLabel: string;
}) {
  return (
    <label className="block">
      <span className="kos-label">{label}</span>
      <select
        className="kos-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            @{option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiPicker({
  label,
  help,
  options,
  selected,
  onChange,
  max,
  disabled,
  prefix,
}: {
  label: string;
  help: string;
  options: DiscordOption[];
  selected: string[];
  onChange: (value: string[]) => void;
  max: number;
  disabled: boolean;
  prefix: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="kos-label">{label}</span>
        <span className="text-[10px] text-kos-muted">
          {selected.length}/{max}
        </span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-black/15 p-2">
        {options.length === 0 ? (
          <p className="p-2 text-xs text-kos-muted">
            No Discord options found.
          </p>
        ) : (
          options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && selected.length >= max)}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id],
                    )
                  }
                  className="h-4 w-4 rounded border-white/20 accent-blue-500"
                />
                <span className="truncate">
                  {prefix}
                  {option.name}
                </span>
              </label>
            );
          })
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-kos-muted">{help}</p>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.08] bg-black/10 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 accent-blue-500"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-kos-muted">
          {description}
        </span>
      </span>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="relative h-7 w-12 rounded-full bg-white/10 transition peer-checked:bg-blue-500 peer-disabled:opacity-50 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
      <span className="text-sm font-semibold">{label}</span>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="kos-label">{label}</span>
      <input
        className={`kos-input ${type === "color" ? "h-10 p-1" : ""}`}
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 1_000_000 : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  maxLength,
  rows,
  placeholder,
  disabled,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows: number;
  placeholder?: string;
  disabled: boolean;
  help?: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="flex items-center justify-between">
        <span className="kos-label">{label}</span>
        <span className="text-[10px] text-kos-muted">
          {value.length}/{maxLength}
        </span>
      </span>
      <textarea
        className="kos-input resize-y"
        value={value}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {help ? (
        <span className="mt-1 block text-xs text-kos-muted">{help}</span>
      ) : null}
    </label>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="kos-metric min-w-24 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}

function StatusLine({
  settings,
  pending,
}: {
  settings?: VerificationSettings;
  pending: boolean;
}) {
  if (!settings) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`kos-badge ${
          settings.enabled
            ? "border-emerald-400/20 text-emerald-300"
            : "text-kos-muted"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            settings.enabled ? "bg-emerald-300" : "bg-white/30"
          }`}
        />
        {settings.enabled ? "Live" : "Disabled"}
      </span>
      {pending ? (
        <span className="kos-badge border-blue-400/20 text-blue-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-300" />
          Applying in Discord
        </span>
      ) : null}
      {settings.controlError ? (
        <span className="kos-badge border-red-400/20 text-red-300">
          Action needed
        </span>
      ) : null}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-kos-muted">{label}</dt>
      <dd className="max-w-[65%] break-words text-right">{value}</dd>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "info" | "error";
}) {
  return (
    <div
      className={`rounded-2xl border p-3 text-sm leading-6 ${
        tone === "error"
          ? "border-red-400/20 bg-red-500/5 text-red-200"
          : "border-blue-400/20 bg-blue-500/5 text-blue-100"
      }`}
    >
      {children}
    </div>
  );
}

function settingsToDraft(settings: VerificationSettings): SettingsDraft {
  return {
    enabled: settings.desiredEnabled ?? settings.enabled,
    verificationChannelId: settings.verificationChannelId ?? "",
    rulesChannelId: settings.rulesChannelId ?? "",
    logChannelId: settings.logChannelId ?? "",
    unverifiedRoleId: settings.unverifiedRoleId ?? "",
    allowedChannelIds: settings.allowedChannelIds ?? [],
    defaultRoleIds: settings.defaultRoleIds ?? [],
    welcomeTitle: settings.welcomeTitle,
    welcomeDescription: settings.welcomeDescription,
    welcomeColor: colorToHex(settings.welcomeColor),
    verifyButtonLabel: settings.verifyButtonLabel,
    verifyButtonEmoji: settings.verifyButtonEmoji ?? "",
    modalTitle: settings.modalTitle,
    modalFieldLabel: settings.modalFieldLabel,
    modalPlaceholder: settings.modalPlaceholder,
    requireCode: settings.requireCode,
    requireRulesAcceptance: settings.requireRulesAcceptance,
    preventCodeReuse: settings.preventCodeReuse,
    successMessage: settings.successMessage,
    failureMessage: settings.failureMessage,
  };
}

function settingsPayload(draft: SettingsDraft) {
  const { enabled: _enabled, ...settings } = draft;
  return settings;
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function codeStatus(code: VerificationCodeRow): string {
  if (!code.active) return "Inactive";
  if (code.expiresAt && new Date(code.expiresAt) <= new Date())
    return "Expired";
  if (code.maxUses !== null && code.uses >= code.maxUses) return "Exhausted";
  return "Active";
}

function formatRelative(value: string): string {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
