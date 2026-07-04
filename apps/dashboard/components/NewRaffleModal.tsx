"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useOrg } from "@/lib/org-context";
import { ImageDrop } from "./ImageDrop";
import { IconClose } from "./icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const CHAINS = ["ETHEREUM", "BASE", "SOLANA", "BITCOIN"];

interface Named {
  id: string;
  name: string;
}

export function NewRaffleModal({ onClose }: { onClose: () => void }) {
  const { slug } = useOrg();
  const router = useRouter();

  const [guilds, setGuilds] = useState<{ guildId: string; name: string }[]>([]);
  const [guildId, setGuildId] = useState("");
  const [meta, setMeta] = useState<{ channels: Named[]; roles: Named[]; hasBotToken: boolean } | null>(null);

  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spots, setSpots] = useState(5);
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
  const [chains, setChains] = useState<string[]>(["ETHEREUM"]);
  const [bannerUrl, setBannerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetcher(`/api/${slug}/guilds`).then((d) => {
      const list = (d.connected ?? []) as { guildId: string; name: string }[];
      setGuilds(list);
      if (list[0]) setGuildId(list[0].guildId);
    });
  }, [slug]);

  useEffect(() => {
    if (!guildId) return;
    setMeta(null);
    setChannelId("");
    setRoleIds([]);
    fetcher(`/api/${slug}/guilds/${guildId}/meta`).then(setMeta);
  }, [slug, guildId]);

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
    const res = await fetch(`/api/${slug}/raffles`, {
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
        startAt: scheduled && startAt ? new Date(startAt).toISOString() : new Date().toISOString(),
        endAt: new Date(endAt).toISOString(),
        startPing,
        hideEntries,
        collectWallets,
        requireWallet,
        walletChains: chains,
        bannerUrl,
        announceChannelId,
        proofChannelId,
        tasks: tasks.filter((t) => t.label.trim()),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.push(`/${slug}/raffles/${body.id}`);
      router.refresh();
    } else {
      setError(body.error ?? "Couldn't create the raffle.");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4">
        <form
          onSubmit={submit}
          className="my-6 w-full max-w-lg rounded-2xl border border-kos-border bg-kos-bg p-6"
        >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New raffle</h2>
          <button type="button" onClick={onClose} className="text-kos-muted hover:text-kos-fg">
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
            <select className="kos-input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              {guilds.map((g) => (
                <option key={g.guildId} value={g.guildId}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Project name">
              <input className="kos-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="CyberKongz" required />
            </Field>
            <Field label="Title (GTD / FCFS)">
              <input className="kos-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GTD WL" required />
            </Field>
          </div>

          <Field label="Description (optional)">
            <textarea className="kos-input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <ImageDrop label="Banner image (optional)" value={bannerUrl} onChange={setBannerUrl} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="WL spots">
              <input type="number" min={1} className="kos-input" value={spots} onChange={(e) => setSpots(Number(e.target.value))} required />
            </Field>
            <Field label="Channel">
              {meta?.hasBotToken ? (
                <select className="kos-input" value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                  <option value="">Select…</option>
                  {meta.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="kos-input" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Channel ID" required />
              )}
            </Field>
          </div>

          <Field label="Eligible roles (none = everyone)">
            {meta?.hasBotToken ? (
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-kos-border bg-kos-panel/50 p-2">
                {meta.roles.length === 0 ? (
                  <div className="text-xs text-kos-muted">No roles found.</div>
                ) : (
                  meta.roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggle(roleIds, r.id, setRoleIds)} />
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
                  setRoleIds(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                }
              />
            )}
          </Field>

          {roleIds.length > 1 ? (
            <Field label="Role match">
              <select className="kos-input" value={roleMatchMode} onChange={(e) => setRoleMatchMode(e.target.value)}>
                <option value="ANY">Any of the roles</option>
                <option value="ALL">Must hold all roles</option>
              </select>
            </Field>
          ) : null}

          {meta?.hasBotToken ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Winners channel (optional)">
                <select className="kos-input" value={announceChannelId} onChange={(e) => setAnnounceChannelId(e.target.value)}>
                  <option value="">Same as raffle</option>
                  {meta.channels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Proof channel (optional)">
                <select className="kos-input" value={proofChannelId} onChange={(e) => setProofChannelId(e.target.value)}>
                  <option value="">Same as winners</option>
                  {meta.channels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <Field label="Social tasks (optional)">
            <div className="space-y-2">
              {tasks.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="kos-input"
                    placeholder="Label (e.g. Follow @KOS)"
                    value={t.label}
                    onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <input
                    className="kos-input"
                    placeholder="https://… (optional)"
                    value={t.url}
                    onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
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
                A task with a link shows as a button (Follow / Like / Join). Without a link it's a
                text step (e.g. "Comment KUON"). Off-platform tasks are honor-system.
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
                <input type="datetime-local" className="kos-input mt-2" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              ) : null}
            </Field>
            <Field label="End">
              <input type="datetime-local" className="kos-input" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ping on start">
              <select className="kos-input" value={startPing} onChange={(e) => setStartPing(e.target.value)}>
                <option value="everyone">@everyone</option>
                <option value="here">@here</option>
                <option value="none">No ping</option>
              </select>
            </Field>
            <Field label="Wallet chains">
              <div className="flex flex-wrap gap-2 pt-1.5">
                {CHAINS.map((c) => (
                  <label key={c} className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={chains.includes(c)} onChange={() => toggle(chains, c, setChains)} />
                    {c.slice(0, 3)}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hideEntries} onChange={(e) => setHideEntries(e.target.checked)} />
              Hide entry count
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={collectWallets} onChange={(e) => setCollectWallets(e.target.checked)} />
              Collect winner wallets
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={requireWallet} onChange={(e) => setRequireWallet(e.target.checked)} />
              Require wallet to enter
            </label>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="kos-btn">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="kos-btn-primary">
            {busy ? "Creating…" : "Create raffle"}
          </button>
        </div>
        <p className="mt-2 text-right text-[11px] text-kos-muted/70">
          The bot posts it to Discord within a few seconds.
        </p>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-kos-muted">{label}</label>
      {children}
    </div>
  );
}
