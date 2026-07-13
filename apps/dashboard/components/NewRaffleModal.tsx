"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useOrg } from "@/lib/org-context";
import type { DuplicateVariant } from "@/lib/raffle-share";
import { ImageDrop } from "./ImageDrop";
import { IconClose } from "./icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];

interface Named {
  id: string;
  name: string;
}

export interface DuplicateRaffleRequest {
  raffleId: number;
  variant: DuplicateVariant;
}

interface DuplicateBlueprint {
  sourceRaffleId: number;
  guildId: string;
  channelId: string;
  announceChannelId: string;
  proofChannelId: string;
  projectName: string;
  title: string;
  description: string;
  spots: number;
  roleMatchMode: string;
  startAt: string;
  endAt: string;
  scheduled: boolean;
  startPing: string;
  hideEntries: boolean;
  collectWallets: boolean;
  requireWallet: boolean;
  useRoleWeights: boolean;
  walletChains: string[];
  bannerUrl: string;
  externalUrl: string;
  tasks: { label: string; url: string }[];
  roles: { roleId: string; roleName: string }[];
  verificationTaskIds: string[];
}

function toLocal(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function NewRaffleModal({
  onClose,
  duplicate,
  collaborationId,
  prefill,
}: {
  onClose: () => void;
  duplicate?: DuplicateRaffleRequest;
  collaborationId?: string;
  prefill?: {
    projectName?: string;
    description?: string;
    bannerUrl?: string;
    externalUrl?: string;
    spots?: number;
  };
}) {
  const { slug } = useOrg();
  const router = useRouter();

  const [guilds, setGuilds] = useState<{ guildId: string; name: string }[]>([]);
  const [guildId, setGuildId] = useState("");
  const [meta, setMeta] = useState<{
    channels: Named[];
    roles: Named[];
    hasBotToken: boolean;
    defaults?: {
      raffleChannelId: string | null;
      announceChannelId: string | null;
      proofChannelId: string | null;
    };
  } | null>(null);

  const [projectName, setProjectName] = useState(prefill?.projectName ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [spots, setSpots] = useState(prefill?.spots ?? 5);
  const [channelId, setChannelId] = useState("");
  const [announceChannelId, setAnnounceChannelId] = useState("");
  const [proofChannelId, setProofChannelId] = useState("");
  const [tasks, setTasks] = useState<{ label: string; url: string }[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [roleMatchMode, setRoleMatchMode] = useState("ANY");
  const [scheduled, setScheduled] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [startPing, setStartPing] = useState("everyone");
  const [hideEntries, setHideEntries] = useState(false);
  const [collectWallets, setCollectWallets] = useState(true);
  const [requireWallet, setRequireWallet] = useState(false);
  const [useRoleWeights, setUseRoleWeights] = useState(false);
  const [chains, setChains] = useState<string[]>(["ETHEREUM"]);
  const [bannerUrl, setBannerUrl] = useState(prefill?.bannerUrl ?? "");
  const [externalUrl, setExternalUrl] = useState(prefill?.externalUrl ?? "");
  const [roleWeights, setRoleWeights] = useState<
    { guildId: string; roleId: string }[]
  >([]);
  const [orgTasks, setOrgTasks] = useState<
    { id: string; title: string; type: string }[]
  >([]);
  const [verificationTaskIds, setVerificationTaskIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [duplicateBlueprint, setDuplicateBlueprint] =
    useState<DuplicateBlueprint | null>(null);
  const [loadingDuplicate, setLoadingDuplicate] = useState(Boolean(duplicate));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetcher(`/api/${slug}/guilds`).then((d) => {
      const list = (d.connected ?? []) as { guildId: string; name: string }[];
      setGuilds(list);
      if (list[0]) setGuildId(list[0].guildId);
    });
    fetcher(`/api/${slug}/tasks`).then((d) => {
      const list = (d.tasks ?? []) as {
        id: string;
        title: string;
        type: string;
        active: boolean;
      }[];
      setOrgTasks(list.filter((t) => t.active));
    });
    fetcher(`/api/${slug}/role-weights`).then((d) => {
      setRoleWeights(
        (d.weights ?? []) as { guildId: string; roleId: string }[],
      );
    });
  }, [slug]);

  useEffect(() => {
    if (!duplicate) return;
    setLoadingDuplicate(true);
    fetcher(
      `/api/${slug}/raffles/${duplicate.raffleId}/duplicate?variant=${duplicate.variant}`,
    )
      .then((data) => {
        if (!data.blueprint) {
          setError(data.error ?? "Couldn't load that raffle.");
          return;
        }
        const blueprint = data.blueprint as DuplicateBlueprint;
        setDuplicateBlueprint(blueprint);
        setGuildId(blueprint.guildId);
        setProjectName(blueprint.projectName);
        setTitle(blueprint.title);
        setDescription(blueprint.description);
        setSpots(blueprint.spots);
        setRoleMatchMode(blueprint.roleMatchMode);
        setScheduled(blueprint.scheduled);
        setStartAt(toLocal(blueprint.startAt));
        setEndAt(toLocal(blueprint.endAt));
        setStartPing(blueprint.startPing);
        setHideEntries(blueprint.hideEntries);
        setCollectWallets(blueprint.collectWallets);
        setRequireWallet(blueprint.requireWallet);
        setUseRoleWeights(blueprint.useRoleWeights);
        setChains(blueprint.walletChains);
        setBannerUrl(blueprint.bannerUrl);
        setExternalUrl(blueprint.externalUrl);
        setTasks(blueprint.tasks);
        setRoleIds(blueprint.roles.map((role) => role.roleId));
        setVerificationTaskIds(blueprint.verificationTaskIds);
      })
      .catch(() => setError("Couldn't load that raffle."))
      .finally(() => setLoadingDuplicate(false));
  }, [duplicate, slug]);

  useEffect(() => {
    if (!guildId) return;
    setMeta(null);
    const blueprint =
      duplicateBlueprint?.guildId === guildId ? duplicateBlueprint : null;
    setChannelId(blueprint?.channelId ?? "");
    setAnnounceChannelId(blueprint?.announceChannelId ?? "");
    setProofChannelId(blueprint?.proofChannelId ?? "");
    setRoleIds(blueprint?.roles.map((role) => role.roleId) ?? []);
    fetcher(`/api/${slug}/guilds/${guildId}/meta`).then((d) => {
      setMeta(d);
      setChannelId(blueprint?.channelId ?? d.defaults?.raffleChannelId ?? "");
      setAnnounceChannelId(
        blueprint?.announceChannelId ?? d.defaults?.announceChannelId ?? "",
      );
      setProofChannelId(
        blueprint?.proofChannelId ?? d.defaults?.proofChannelId ?? "",
      );
    });
  }, [slug, guildId, duplicateBlueprint]);

  // Lock the page behind the modal so only the dialog scrolls.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!endAt) return setError("Pick an end time.");
    setBusy(true);
    const endpoint = duplicate
      ? `/api/${slug}/raffles/${duplicate.raffleId}/duplicate?variant=${duplicate.variant}`
      : `/api/${slug}/raffles`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId,
        channelId,
        projectName,
        title,
        description,
        spots: Number(spots),
        roleMatchMode,
        roles: roleIds.map((id) => ({
          roleId: id,
          roleName: meta?.roles.find((r) => r.id === id)?.name ?? id,
        })),
        startAt:
          scheduled && startAt
            ? new Date(startAt).toISOString()
            : new Date().toISOString(),
        endAt: new Date(endAt).toISOString(),
        startPing,
        hideEntries,
        collectWallets,
        requireWallet,
        useRoleWeights,
        walletChains: chains,
        bannerUrl,
        externalUrl,
        announceChannelId,
        proofChannelId,
        tasks: tasks.filter((t) => t.label.trim()),
        verificationTaskIds,
        collaborationId,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push(
        `/${slug}/raffles/${body.id}${duplicate ? "?duplicated=1&edit=1" : ""}`,
      );
      router.refresh();
    } else {
      setError(body.error ?? "Couldn't create the raffle.");
    }
  }

  if (typeof document === "undefined") return null;
  const weightedRoleCount = roleWeights.filter(
    (w) => w.guildId === guildId,
  ).length;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 backdrop-blur-xl"
    >
      <div className="flex min-h-full items-start justify-center p-3 sm:p-6">
        <motion.form
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onSubmit={submit}
          className="my-4 w-full max-w-3xl rounded-[2rem] border border-white/[0.10] bg-[#0A0A0A]/95 p-5 shadow-2xl shadow-black/60 sm:my-8 sm:p-6"
        >
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/90">
                Raffle builder
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                {duplicate
                  ? `Duplicate raffle #${duplicate.raffleId}`
                  : "New raffle"}
              </h2>
              <p className="mt-1 text-sm text-kos-muted">
                {duplicate
                  ? "Everything is prefilled. Review spots and timing, then publish the fresh raffle."
                  : "Set the public page, Discord post, gates, and wallet rules in one flow."}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close raffle builder"
              onClick={onClose}
              className="rounded-xl p-2 text-kos-muted transition-colors hover:bg-white/[0.06] hover:text-kos-fg"
            >
              <IconClose />
            </button>
          </div>

          {error ? (
            <p className="mb-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          ) : null}

          <div className="space-y-3">
            <Field label="Server">
              <select
                className="kos-input"
                value={guildId}
                onChange={(e) => setGuildId(e.target.value)}
                disabled={Boolean(duplicate)}
              >
                {guilds.map((g) => (
                  <option key={g.guildId} value={g.guildId}>
                    {g.name}
                  </option>
                ))}
              </select>
              {duplicate ? (
                <p className="mt-1 text-[11px] text-kos-muted/70">
                  For tenant safety, this copy stays in the source community.
                </p>
              ) : null}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Project name">
                <input
                  className="kos-input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="CyberKongz"
                  required
                />
              </Field>
              <Field label="Title (GTD / FCFS)">
                <input
                  className="kos-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="GTD WL"
                  required
                />
              </Field>
            </div>

            <Field label="Description (optional)">
              <textarea
                className="kos-input min-h-[60px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <Field label="Project link (optional)">
              <input
                type="url"
                className="kos-input"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://project.example"
              />
            </Field>

            <ImageDrop
              label="Banner image (optional)"
              value={bannerUrl}
              onChange={setBannerUrl}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field label="WL spots">
                <input
                  type="number"
                  min={1}
                  className="kos-input"
                  value={spots}
                  onChange={(e) => setSpots(Number(e.target.value))}
                  required
                />
              </Field>
              <Field label="Raffle post channel">
                {meta?.hasBotToken ? (
                  <select
                    className="kos-input"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {meta.channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="kos-input"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    placeholder="Channel ID"
                    required
                  />
                )}
                {meta?.defaults?.raffleChannelId ? (
                  <p className="mt-1 text-[11px] text-kos-muted/70">
                    Prefilled from Settings. You can change it for this raffle.
                  </p>
                ) : null}
              </Field>
            </div>

            <Field label="Eligible roles (none = everyone)">
              {meta?.hasBotToken ? (
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2">
                  {meta.roles.length === 0 ? (
                    <div className="text-xs text-kos-muted">
                      No roles found.
                    </div>
                  ) : (
                    meta.roles.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={roleIds.includes(r.id)}
                          onChange={() => toggle(roleIds, r.id, setRoleIds)}
                        />
                        {r.name}
                      </label>
                    ))
                  )}
                </div>
              ) : (
                <input
                  className="kos-input"
                  placeholder="Comma-separated role IDs (optional)"
                  onChange={(e) =>
                    setRoleIds(
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            </Field>

            {roleIds.length > 1 ? (
              <Field label="Role match">
                <select
                  className="kos-input"
                  value={roleMatchMode}
                  onChange={(e) => setRoleMatchMode(e.target.value)}
                >
                  <option value="ANY">Any of the roles</option>
                  <option value="ALL">Must hold all roles</option>
                </select>
              </Field>
            ) : null}

            {meta?.hasBotToken ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Winners channel (optional)">
                  <select
                    className="kos-input"
                    value={announceChannelId}
                    onChange={(e) => setAnnounceChannelId(e.target.value)}
                  >
                    <option value="">Same as raffle</option>
                    {meta.channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Proof channel (optional)">
                  <select
                    className="kos-input"
                    value={proofChannelId}
                    onChange={(e) => setProofChannelId(e.target.value)}
                  >
                    <option value="">Same as winners</option>
                    {meta.channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}

            {orgTasks.length > 0 ? (
              <Field label="Verified tasks (gate entry — from your Points panel)">
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2">
                  {orgTasks.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={verificationTaskIds.includes(t.id)}
                        onChange={() =>
                          toggle(
                            verificationTaskIds,
                            t.id,
                            setVerificationTaskIds,
                          )
                        }
                      />
                      {t.title}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-kos-muted/70">
                  Members must verify these on their KOS profile before they can
                  enter.
                </p>
              </Field>
            ) : null}

            <Field label="Social tasks (optional)">
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="kos-input"
                      placeholder="Label (e.g. Follow @KOS)"
                      value={t.label}
                      onChange={(e) =>
                        setTasks(
                          tasks.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      className="kos-input"
                      placeholder="https://… (optional)"
                      value={t.url}
                      onChange={(e) =>
                        setTasks(
                          tasks.map((x, j) =>
                            j === i ? { ...x, url: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
                      className="shrink-0 rounded-lg px-2 text-kos-muted hover:text-red-400"
                      aria-label="Remove task"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {tasks.length < 10 ? (
                  <button
                    type="button"
                    onClick={() => setTasks([...tasks, { label: "", url: "" }])}
                    className="kos-btn text-xs"
                  >
                    + Add task
                  </button>
                ) : null}
                <p className="text-[11px] text-kos-muted/70">
                  A task with a link shows as a button (Follow / Like / Join).
                  Without a link it's a text step (e.g. "Comment KUON").
                  Off-platform tasks are honor-system.
                </p>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <select
                  className="kos-input"
                  value={scheduled ? "later" : "now"}
                  onChange={(e) => setScheduled(e.target.value === "later")}
                >
                  <option value="now">Immediately</option>
                  <option value="later">Schedule…</option>
                </select>
                {scheduled ? (
                  <input
                    type="datetime-local"
                    className="kos-input mt-2"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                  />
                ) : null}
              </Field>
              <Field label="End">
                <input
                  type="datetime-local"
                  className="kos-input"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Ping on start">
                <select
                  className="kos-input"
                  value={startPing}
                  onChange={(e) => setStartPing(e.target.value)}
                >
                  <option value="everyone">@everyone</option>
                  <option value="here">@here</option>
                  <option value="none">No ping</option>
                </select>
              </Field>
              <Field label="Wallet chains">
                <div className="flex flex-wrap gap-2 pt-1.5">
                  {CHAINS.map((c) => (
                    <label key={c} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={chains.includes(c)}
                        onChange={() => toggle(chains, c, setChains)}
                      />
                      {c.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hideEntries}
                  onChange={(e) => setHideEntries(e.target.checked)}
                />
                Hide entry count
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={collectWallets}
                  onChange={(e) => setCollectWallets(e.target.checked)}
                />
                Collect winner wallets
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={requireWallet}
                  onChange={(e) => setRequireWallet(e.target.checked)}
                />
                Require wallet to enter
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useRoleWeights}
                  onChange={(e) => setUseRoleWeights(e.target.checked)}
                />
                Weighted draw
              </label>
            </div>
            {useRoleWeights ? (
              <p className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-100/90">
                {weightedRoleCount > 0
                  ? `${weightedRoleCount} weighted role${weightedRoleCount === 1 ? "" : "s"} configured for this server.`
                  : "No weighted roles are configured for this server yet. Everyone will default to 1× until Settings → Weighted raffle roles is configured."}
              </p>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="kos-btn">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || loadingDuplicate}
              className="kos-btn-primary"
            >
              {loadingDuplicate
                ? "Loading copy…"
                : busy
                  ? duplicate
                    ? "Duplicating…"
                    : "Creating…"
                  : duplicate
                    ? "Duplicate & publish"
                    : "Create raffle"}
            </button>
          </div>
          <p className="mt-2 text-right text-[11px] text-kos-muted/70">
            The bot posts it to Discord within a few seconds.
          </p>
        </motion.form>
      </div>
    </motion.div>,
    document.body,
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
    <div>
      <label className="kos-label">{label}</label>
      {children}
    </div>
  );
}
