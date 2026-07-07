"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ImageDrop } from "./ImageDrop";
import { IconClose } from "./icons";

const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];
const fetcher = (u: string) => fetch(u).then((r) => r.json());

export interface EditableRaffle {
  id: number;
  guildId: string;
  status: string;
  projectName: string;
  title: string;
  description: string | null;
  spots: number;
  startAt: string;
  endAt: string;
  bannerUrl: string | null;
  hideEntries: boolean;
  requireWallet: boolean;
  useRoleWeights: boolean;
  startPing: string;
  roleMatchMode: string;
  walletChains: string[];
  collectWallets: boolean;
  announceChannelId: string | null;
  proofChannelId: string | null;
  tasks: { label: string; url?: string }[];
  verificationTasks: { id: string; title: string; type: string }[];
  verificationTaskIds: string[];
  roles: { roleId: string; roleName: string }[];
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function RaffleEditButton({ raffle }: { raffle: EditableRaffle }) {
  const canEdit = useCan(PERMISSIONS.RAFFLE_EDIT);
  const [open, setOpen] = useState(false);
  if (!canEdit || raffle.status === "ENDED" || raffle.status === "CANCELLED")
    return null;
  return (
    <>
      <button className="kos-btn" onClick={() => setOpen(true)}>
        Edit raffle
      </button>
      {open ? (
        <EditModal raffle={raffle} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function EditModal({
  raffle,
  onClose,
}: {
  raffle: EditableRaffle;
  onClose: () => void;
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [meta, setMeta] = useState<{
    channels: { id: string; name: string }[];
    roles: { id: string; name: string }[];
    hasBotToken: boolean;
  } | null>(null);

  const [projectName, setProjectName] = useState(raffle.projectName);
  const [title, setTitle] = useState(raffle.title);
  const [description, setDescription] = useState(raffle.description ?? "");
  const [spots, setSpots] = useState(raffle.spots);
  const [endAt, setEndAt] = useState(toLocal(raffle.endAt));
  const [bannerUrl, setBannerUrl] = useState(raffle.bannerUrl ?? "");
  const [hideEntries, setHideEntries] = useState(raffle.hideEntries);
  const [requireWallet, setRequireWallet] = useState(raffle.requireWallet);
  const [useRoleWeights, setUseRoleWeights] = useState(raffle.useRoleWeights);
  const [startPing, setStartPing] = useState(raffle.startPing);
  const [roleMatchMode, setRoleMatchMode] = useState(raffle.roleMatchMode);
  const [chains, setChains] = useState<string[]>(raffle.walletChains);
  const [collectWallets, setCollectWallets] = useState(raffle.collectWallets);
  const [announceChannelId, setAnnounceChannelId] = useState(
    raffle.announceChannelId ?? "",
  );
  const [proofChannelId, setProofChannelId] = useState(
    raffle.proofChannelId ?? "",
  );
  const [roleIds, setRoleIds] = useState<string[]>(
    raffle.roles.map((r) => r.roleId),
  );
  const [tasks, setTasks] = useState<{ label: string; url: string }[]>(
    raffle.tasks.map((t) => ({ label: t.label, url: t.url ?? "" })),
  );
  const [verificationTaskIds, setVerificationTaskIds] = useState<string[]>(
    raffle.verificationTaskIds,
  );
  const [roleWeights, setRoleWeights] = useState<
    { guildId: string; roleId: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetcher(`/api/${slug}/guilds/${raffle.guildId}/meta`).then(setMeta);
    fetcher(`/api/${slug}/role-weights`).then((d) => {
      setRoleWeights(
        (d.weights ?? []) as { guildId: string; roleId: string }[],
      );
    });
  }, [slug, raffle.guildId]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${slug}/raffles/${raffle.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName,
        title,
        description,
        spots: Number(spots),
        endAt: new Date(endAt).toISOString(),
        bannerUrl,
        hideEntries,
        requireWallet,
        useRoleWeights,
        startPing,
        roleMatchMode,
        walletChains: chains,
        collectWallets,
        announceChannelId,
        proofChannelId,
        roles: roleIds.map((id) => ({
          roleId: id,
          roleName: meta?.roles.find((r) => r.id === id)?.name ?? id,
        })),
        tasks: tasks.filter((t) => t.label.trim()),
        verificationTaskIds,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setError(body.error ?? "Couldn't save.");
    }
  }

  if (typeof document === "undefined") return null;
  const weightedRoleCount = roleWeights.filter(
    (w) => w.guildId === raffle.guildId,
  ).length;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 backdrop-blur-xl">
      <div className="flex min-h-full items-start justify-center p-3 sm:p-6">
        <form
          onSubmit={save}
          className="my-4 w-full max-w-3xl rounded-[2rem] border border-white/[0.10] bg-[#0A0A0A]/95 p-5 shadow-2xl shadow-black/60 sm:my-8 sm:p-6"
        >
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/90">
                Raffle settings
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                Edit raffle #{raffle.id}
              </h2>
              <p className="mt-1 text-sm text-kos-muted">
                Update the web page, Discord controls, tasks, and entry rules.
              </p>
            </div>
            <button
              type="button"
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
            <div className="grid grid-cols-2 gap-3">
              <F label="Project name">
                <input
                  className="kos-input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </F>
              <F label="Title">
                <input
                  className="kos-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </F>
            </div>
            <F label="Description">
              <textarea
                className="kos-input min-h-[60px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </F>
            <ImageDrop
              label="Banner image"
              value={bannerUrl}
              onChange={setBannerUrl}
            />
            <div className="grid grid-cols-2 gap-3">
              <F label="WL spots">
                <input
                  type="number"
                  min={1}
                  className="kos-input"
                  value={spots}
                  onChange={(e) => setSpots(Number(e.target.value))}
                />
              </F>
              <F label="End">
                <input
                  type="datetime-local"
                  className="kos-input"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </F>
            </div>

            {meta?.hasBotToken ? (
              <>
                <F label="Eligible roles (none = everyone)">
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2">
                    {meta.roles.map((r) => (
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
                    ))}
                  </div>
                </F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Winners channel">
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
                  </F>
                  <F label="Proof channel">
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
                  </F>
                </div>
              </>
            ) : null}

            {roleIds.length > 1 ? (
              <F label="Role match">
                <select
                  className="kos-input"
                  value={roleMatchMode}
                  onChange={(e) => setRoleMatchMode(e.target.value)}
                >
                  <option value="ANY">Any of the roles</option>
                  <option value="ALL">Must hold all roles</option>
                </select>
              </F>
            ) : null}

            {raffle.verificationTasks.length > 0 ? (
              <F label="Verified tasks (gate entry)">
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2">
                  {raffle.verificationTasks.map((t) => (
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
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-[10px] text-kos-muted">
                        {t.type}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-kos-muted/70">
                  Members must verify every selected task before entering.
                </p>
              </F>
            ) : null}

            <F label="Social tasks">
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="kos-input"
                      placeholder="Label"
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
                      className="shrink-0 px-2 text-kos-muted hover:text-red-400"
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
              </div>
            </F>

            <div className="grid grid-cols-2 gap-3">
              <F label="Ping on start">
                <select
                  className="kos-input"
                  value={startPing}
                  onChange={(e) => setStartPing(e.target.value)}
                >
                  <option value="everyone">@everyone</option>
                  <option value="here">@here</option>
                  <option value="none">No ping</option>
                </select>
              </F>
              <F label="Wallet chains">
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
              </F>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hideEntries}
                  onChange={(e) => setHideEntries(e.target.checked)}
                />{" "}
                Hide entry count
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={collectWallets}
                  onChange={(e) => setCollectWallets(e.target.checked)}
                />{" "}
                Collect wallets
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={requireWallet}
                  onChange={(e) => setRequireWallet(e.target.checked)}
                />{" "}
                Require wallet
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useRoleWeights}
                  onChange={(e) => setUseRoleWeights(e.target.checked)}
                />{" "}
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
            <button type="submit" disabled={busy} className="kos-btn-primary">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
          <p className="mt-2 text-right text-[11px] text-kos-muted/70">
            If it's already posted, the bot updates the Discord message within a
            few seconds.
          </p>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="kos-label">{label}</label>
      {children}
    </div>
  );
}
