"use client";

import Link from "next/link";
import useSWR from "swr";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useOrg } from "@/lib/org-context";
import {
  Empty,
  SectionTitle,
  StatCard,
  StatusBadge,
  TableShell,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevron,
  IconSearch,
} from "@/components/icons";

const fetcher = (url: string) =>
  fetch(url).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Request failed.");
    return body;
  });

type SelectionMode = "ROUND_ROBIN" | "RANDOM" | "PRIORITY";

interface PoolMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleName: string;
  priority: number;
}

interface WalletHistory {
  id: string;
  raffleId: number;
  raffleTitle: string;
  raffleStatus: string;
  project: string;
  status: string;
  reservedAt: string;
  releasedAt: string | null;
}

interface TeamWallet {
  id: string;
  ownerId: string;
  ownerName: string;
  chain: string;
  chains: string[];
  address: string;
  status: "AVAILABLE" | "RESERVED" | "DISABLED";
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
  history: WalletHistory[];
}

interface PoolData {
  pool: { id: string; selectionMode: SelectionMode };
  viewer: { userId: string; canManageAll: boolean; canFill: boolean };
  members: PoolMember[];
  wallets: TeamWallet[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    available: number;
    reserved: number;
    disabled: number;
    totalTeamMembers: number;
    mostUsedWallets: {
      id: string;
      address: string;
      ownerName: string;
      timesUsed: number;
    }[];
    mostActiveTeamMember: {
      userId: string;
      name: string;
      timesUsed: number;
    } | null;
  };
}

const CHAINS = ["ETHEREUM", "BASE", "ROBINHOOD", "SOLANA", "BITCOIN"] as const;
const CHAIN_LABELS: Record<(typeof CHAINS)[number], string> = {
  ETHEREUM: "Ethereum",
  BASE: "Base",
  ROBINHOOD: "Robinhood",
  SOLANA: "Solana",
  BITCOIN: "Bitcoin",
};
const MODES: { value: SelectionMode; label: string; hint: string }[] = [
  {
    value: "ROUND_ROBIN",
    label: "Round Robin",
    hint: "One wallet per member in rotation.",
  },
  { value: "RANDOM", label: "Random", hint: "Random eligible wallets." },
  {
    value: "PRIORITY",
    label: "Priority",
    hint: "Use the admin-defined member order.",
  },
];

export function TeamWalletPoolManager() {
  const { slug } = useOrg();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (deferredSearch.trim()) params.set("q", deferredSearch.trim());
    return params.toString();
  }, [deferredSearch, page, pageSize]);
  const { data, error, isLoading, mutate } = useSWR<PoolData>(
    `/api/${slug}/team-wallets?${query}`,
    fetcher,
  );
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState("");
  const [selectedChains, setSelectedChains] = useState<
    (typeof CHAINS)[number][]
  >(["ETHEREUM"]);
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<
    { row: number; error: string }[]
  >([]);
  const [priorityIds, setPriorityIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] =
    useState<SelectionMode>("ROUND_ROBIN");
  const fileRef = useRef<HTMLInputElement>(null);
  const walletSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const syncPageSize = () => setPageSize(desktop.matches ? 100 : 25);
    syncPageSize();
    desktop.addEventListener("change", syncPageSize);
    return () => desktop.removeEventListener("change", syncPageSize);
  }, []);
  useEffect(() => setPage(1), [deferredSearch, pageSize]);
  useEffect(() => {
    if (!data) return;
    setPriorityIds(data.members.map((member) => member.userId));
    setSelectionMode(data.pool.selectionMode);
    setOwnerId((current) => current || data.viewer.userId);
  }, [data]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function importWallets() {
    if (!content.trim() || !selectedChains.length) return;
    setBusy("import");
    setNotice(null);
    setImportErrors([]);
    const response = await fetch(`/api/${slug}/team-wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, chains: selectedChains, ownerId }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setImportErrors(body.errors ?? []);
    if (!response.ok) {
      setNotice(body.error ?? "Wallets could not be added.");
      return;
    }
    const changes = [
      body.imported
        ? `${body.imported} wallet${body.imported === 1 ? "" : "s"} added`
        : null,
      body.updated
        ? `${body.updated} existing wallet${body.updated === 1 ? "" : "s"} expanded`
        : null,
      body.errors?.length ? `${body.errors.length} skipped` : null,
    ].filter(Boolean);
    setNotice(`${changes.join(" · ")}.`);
    setContent("");
    setShowImport(false);
    await mutate();
  }

  async function readFile(file: File) {
    if (file.size > 1_000_000) {
      setNotice("CSV/TXT files must be 1 MB or smaller.");
      return;
    }
    setContent(await file.text());
  }

  function toggleChain(chain: (typeof CHAINS)[number]) {
    setSelectedChains((current) =>
      current.includes(chain)
        ? current.filter((value) => value !== chain)
        : [...current, chain],
    );
  }

  async function changeStatus(wallet: TeamWallet) {
    setBusy(wallet.id);
    const response = await fetch(`/api/${slug}/team-wallets/${wallet.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: wallet.status === "DISABLED" }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(
      response.ok
        ? wallet.status === "DISABLED"
          ? "Wallet enabled."
          : "Wallet disabled."
        : (body.error ?? "Wallet status could not be changed."),
    );
    if (response.ok) await mutate();
  }

  async function deleteWallet(wallet: TeamWallet) {
    if (!confirm("Delete this wallet from the Team Wallet Pool?")) return;
    setBusy(wallet.id);
    const response = await fetch(`/api/${slug}/team-wallets/${wallet.id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(
      response.ok ? "Wallet deleted." : (body.error ?? "Delete failed."),
    );
    if (response.ok) await mutate();
  }

  async function savePriority() {
    setBusy("priority");
    const response = await fetch(`/api/${slug}/team-wallets/priorities`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: priorityIds, selectionMode }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setNotice(
      response.ok
        ? "Pool selection settings saved."
        : (body.error ?? "Save failed."),
    );
    if (response.ok) await mutate();
  }

  function movePriority(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= priorityIds.length) return;
    setPriorityIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function goToPage(nextPage: number) {
    setPage(nextPage);
    walletSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  if (error) return <Empty>{error.message}</Empty>;
  if (isLoading || !data) return <Empty>Loading Team Wallet Pool…</Empty>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Wallets" value={data.stats.total} />
        <StatCard label="Available" value={data.stats.available} />
        <StatCard label="Reserved" value={data.stats.reserved} />
        <StatCard label="Disabled" value={data.stats.disabled} />
        <StatCard label="Team Members" value={data.stats.totalTeamMembers} />
      </div>

      <details className="kos-card group overflow-hidden lg:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Selection settings</div>
            <div className="mt-0.5 truncate text-xs text-kos-muted">
              {MODES.find((mode) => mode.value === selectionMode)?.label} ·{" "}
              {priorityIds.length} team member
              {priorityIds.length === 1 ? "" : "s"}
            </div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-kos-muted transition-transform group-open:rotate-180">
            <IconChevron />
          </span>
        </summary>
        <div className="border-t border-white/[0.08] p-4">
          <SelectionSettings
            members={data.members}
            priorityIds={priorityIds}
            selectionMode={selectionMode}
            canManageAll={data.viewer.canManageAll}
            busy={busy === "priority"}
            onModeChange={setSelectionMode}
            onMove={movePriority}
            onSave={() => void savePriority()}
          />
        </div>
      </details>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
        <div ref={walletSectionRef} className="kos-card p-3 sm:p-5">
          <SectionTitle
            action={
              <button
                type="button"
                className="kos-btn-primary min-h-10 shrink-0"
                onClick={() => setShowImport((value) => !value)}
              >
                {showImport ? "Close" : "+ Add wallets"}
              </button>
            }
          >
            Wallets
          </SectionTitle>
          {showImport ? (
            <div className="mb-5 rounded-3xl border border-blue-400/15 bg-blue-500/[0.045] p-3 sm:p-4">
              <div className="grid gap-3">
                {data.viewer.canManageAll ? (
                  <label className="w-full sm:max-w-md">
                    <span className="kos-label">Wallet owner</span>
                    <select
                      className="kos-input"
                      value={ownerId}
                      onChange={(event) => setOwnerId(event.target.value)}
                    >
                      {data.members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name} · {member.roleName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <fieldset>
                  <legend className="kos-label">Use wallets on</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    {CHAINS.map((chain) => {
                      const checked = selectedChains.includes(chain);
                      return (
                        <label
                          key={chain}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-2.5 py-2.5 text-xs transition sm:px-3 sm:text-sm ${
                            checked
                              ? "border-blue-400/35 bg-blue-500/10 text-blue-100"
                              : "border-white/[0.08] bg-white/[0.025] text-kos-muted hover:border-white/[0.16] hover:text-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-500"
                            checked={checked}
                            onChange={() => toggleChain(chain)}
                          />
                          <span>{CHAIN_LABELS[chain]}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-kos-muted">
                    Wallets without a CSV chain column are assigned to every
                    selected chain. Each address must be valid on all of those
                    chains; an explicit chain column overrides this selection
                    for that row.
                  </p>
                  {!selectedChains.length ? (
                    <p className="mt-1 text-xs text-amber-300">
                      Select at least one chain.
                    </p>
                  ) : null}
                </fieldset>
              </div>
              <label className="mt-3 block">
                <span className="kos-label">Paste addresses or CSV</span>
                <textarea
                  className="kos-input !min-h-40 font-mono text-xs"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={
                    "One address per line. Optional CSV: chain,wallet_address"
                  }
                />
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
              <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <button
                  type="button"
                  className="kos-btn min-h-11 w-full justify-center sm:w-auto"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose CSV/TXT
                </button>
                <button
                  type="button"
                  className="kos-btn-primary min-h-11 w-full justify-center sm:w-auto"
                  disabled={
                    !content.trim() ||
                    !selectedChains.length ||
                    busy === "import"
                  }
                  onClick={importWallets}
                >
                  {busy === "import" ? "Validating…" : "Validate & add"}
                </button>
              </div>
              {importErrors.length ? (
                <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-3 text-xs text-amber-100/80">
                  {importErrors.slice(0, 5).map((item) => (
                    <div key={`${item.row}-${item.error}`}>
                      Row {item.row}: {item.error}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="relative mb-4">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-kos-muted" />
            <input
              className="kos-input pl-11"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search address, owner, chain, or status"
              aria-label="Search team wallets"
            />
          </div>

          {data.wallets.length === 0 ? (
            <Empty>
              {search
                ? "No team wallets match your search."
                : "No wallets yet. Add your first validated team wallet."}
            </Empty>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {data.wallets.map((wallet) => (
                  <WalletMobileCard
                    key={wallet.id}
                    wallet={wallet}
                    orgSlug={slug}
                    expanded={expanded === wallet.id}
                    busy={busy === wallet.id}
                    onToggleHistory={() =>
                      setExpanded((value) =>
                        value === wallet.id ? null : wallet.id,
                      )
                    }
                    onChangeStatus={() => void changeStatus(wallet)}
                    onDelete={() => void deleteWallet(wallet)}
                  />
                ))}
              </div>
              <div className="hidden lg:block">
                <TableShell>
                  <table className="kos-table">
                    <thead>
                      <tr>
                        <th>Wallet Address</th>
                        <th>Owner</th>
                        <th>Chain</th>
                        <th>Status</th>
                        <th className="text-right">Times Used</th>
                        <th>Last Used</th>
                        <th>Created</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.wallets.map((wallet) => (
                        <WalletRows
                          key={wallet.id}
                          wallet={wallet}
                          orgSlug={slug}
                          expanded={expanded === wallet.id}
                          busy={busy === wallet.id}
                          onToggleHistory={() =>
                            setExpanded((value) =>
                              value === wallet.id ? null : wallet.id,
                            )
                          }
                          onChangeStatus={() => void changeStatus(wallet)}
                          onDelete={() => void deleteWallet(wallet)}
                        />
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              </div>
            </>
          )}
          {data.pagination.totalPages > 1 ? (
            <div className="mt-4 flex flex-col gap-3 text-sm text-kos-muted sm:flex-row sm:items-center sm:justify-between">
              <span>
                {data.pagination.total} wallets · Page {data.pagination.page} of{" "}
                {data.pagination.totalPages}
              </span>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  className="kos-btn min-h-11 justify-center"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </button>
                <button
                  className="kos-btn min-h-11 justify-center"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="kos-card p-4">
            <SectionTitle>Pool activity</SectionTitle>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="text-xs text-kos-muted">
                Most active team member
              </div>
              <div className="mt-1 font-medium">
                {data.stats.mostActiveTeamMember?.name ?? "No usage yet"}
              </div>
              {data.stats.mostActiveTeamMember ? (
                <div className="text-xs text-kos-muted">
                  {data.stats.mostActiveTeamMember.timesUsed} reservations
                </div>
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              <div className="text-xs text-kos-muted">Most used wallets</div>
              {data.stats.mostUsedWallets.length ? (
                data.stats.mostUsedWallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono">
                        {shortAddress(wallet.address)}
                      </div>
                      <div className="truncate text-kos-muted">
                        {wallet.ownerName}
                      </div>
                    </div>
                    <span className="kos-badge">{wallet.timesUsed}×</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-kos-muted">No usage yet.</div>
              )}
            </div>
          </div>

          <div className="kos-card hidden p-4 lg:block">
            <SectionTitle>Selection settings</SectionTitle>
            <SelectionSettings
              members={data.members}
              priorityIds={priorityIds}
              selectionMode={selectionMode}
              canManageAll={data.viewer.canManageAll}
              busy={busy === "priority"}
              onModeChange={setSelectionMode}
              onMove={movePriority}
              onSave={() => void savePriority()}
            />
          </div>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[140] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-white/[0.10] bg-[#181818]/95 p-3.5 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-2xl"
        >
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function SelectionSettings({
  members,
  priorityIds,
  selectionMode,
  canManageAll,
  busy,
  onModeChange,
  onMove,
  onSave,
}: {
  members: PoolMember[];
  priorityIds: string[];
  selectionMode: SelectionMode;
  canManageAll: boolean;
  busy: boolean;
  onModeChange: (mode: SelectionMode) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onSave: () => void;
}) {
  const memberById = new Map(members.map((member) => [member.userId, member]));

  return (
    <>
      <label>
        <span className="kos-label">Default mode</span>
        <select
          className="kos-input"
          value={selectionMode}
          disabled={!canManageAll}
          onChange={(event) =>
            onModeChange(event.target.value as SelectionMode)
          }
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-kos-muted">
          {MODES.find((mode) => mode.value === selectionMode)?.hint}
        </p>
      </label>
      <div className="mt-4">
        <div className="kos-label">Member priority</div>
        <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
          {priorityIds.map((userId, index) => {
            const member = memberById.get(userId);
            if (!member) return null;
            return (
              <div
                key={userId}
                className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-xs text-kos-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {member.name}
                  </div>
                  <div className="text-[11px] text-kos-muted">
                    {member.roleName}
                  </div>
                </div>
                {canManageAll ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${member.name} up`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-kos-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => onMove(index, -1)}
                    >
                      <IconArrowUp width={15} height={15} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${member.name} down`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-kos-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                      disabled={index === priorityIds.length - 1}
                      onClick={() => onMove(index, 1)}
                    >
                      <IconArrowDown width={15} height={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {canManageAll ? (
        <button
          type="button"
          className="kos-btn-primary mt-4 w-full"
          disabled={busy}
          onClick={onSave}
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      ) : (
        <p className="mt-4 text-xs leading-5 text-kos-muted">
          Admins arrange priority. Round Robin remains the default fill mode.
        </p>
      )}
    </>
  );
}

type WalletDisplayProps = {
  wallet: TeamWallet;
  orgSlug: string;
  expanded: boolean;
  busy: boolean;
  onToggleHistory: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
};

function WalletMobileCard({
  wallet,
  orgSlug,
  expanded,
  busy,
  onToggleHistory,
  onChangeStatus,
  onDelete,
}: WalletDisplayProps) {
  const actionsDisabled = busy || wallet.status === "RESERVED";

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            className="block max-w-full truncate font-mono text-sm font-medium hover:text-blue-300"
            title="Copy wallet address"
            aria-label={`Copy wallet ${wallet.address}`}
            onClick={() => void navigator.clipboard.writeText(wallet.address)}
          >
            {shortAddress(wallet.address)}
          </button>
          <div className="mt-1 truncate text-xs text-kos-muted">
            {wallet.ownerName}
          </div>
        </div>
        <div className="shrink-0">
          <StatusBadge status={wallet.status} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {wallet.chains.map((chain) => (
          <span
            key={chain}
            className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[11px] text-kos-muted"
          >
            {CHAIN_LABELS[chain as keyof typeof CHAIN_LABELS] ?? chain}
          </span>
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 border-y border-white/[0.07] py-3 text-xs">
        <div>
          <dt className="text-kos-muted">Times used</dt>
          <dd className="mt-0.5 font-medium text-white">{wallet.timesUsed}</dd>
        </div>
        <div>
          <dt className="text-kos-muted">Last used</dt>
          <dd className="mt-0.5 truncate text-white">
            {fmtDate(wallet.lastUsedAt)}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-kos-muted">Added</dt>
          <dd className="mt-0.5 text-white">{fmtDate(wallet.createdAt)}</dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          className="kos-btn min-h-10 justify-center px-2 text-xs"
          aria-expanded={expanded}
          onClick={onToggleHistory}
        >
          {expanded ? "Hide" : "History"}
        </button>
        <button
          type="button"
          className="kos-btn min-h-10 justify-center px-2 text-xs"
          disabled={actionsDisabled}
          onClick={onChangeStatus}
        >
          {wallet.status === "DISABLED" ? "Enable" : "Disable"}
        </button>
        <button
          type="button"
          className="min-h-10 rounded-xl px-2 text-xs text-kos-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>

      {expanded ? (
        <div className="mt-3">
          <WalletHistoryPanel wallet={wallet} orgSlug={orgSlug} />
        </div>
      ) : null}
    </article>
  );
}

function WalletRows({
  wallet,
  orgSlug,
  expanded,
  busy,
  onToggleHistory,
  onChangeStatus,
  onDelete,
}: WalletDisplayProps) {
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="font-mono text-xs hover:text-blue-300"
            title="Copy wallet address"
            onClick={() => void navigator.clipboard.writeText(wallet.address)}
          >
            {shortAddress(wallet.address)}
          </button>
        </td>
        <td>{wallet.ownerName}</td>
        <td>
          <div className="flex max-w-56 flex-wrap gap-1">
            {wallet.chains.map((chain) => (
              <span
                key={chain}
                className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[11px] text-kos-muted"
              >
                {CHAIN_LABELS[chain as keyof typeof CHAIN_LABELS] ?? chain}
              </span>
            ))}
          </div>
        </td>
        <td>
          <StatusBadge status={wallet.status} />
        </td>
        <td className="text-right font-medium">{wallet.timesUsed}</td>
        <td className="whitespace-nowrap text-kos-muted">
          {fmtDate(wallet.lastUsedAt)}
        </td>
        <td className="whitespace-nowrap text-kos-muted">
          {fmtDate(wallet.createdAt)}
        </td>
        <td>
          <div className="flex justify-end gap-1">
            <button
              className="kos-btn px-2.5 py-1.5 text-xs"
              onClick={onToggleHistory}
            >
              History
            </button>
            <button
              className="kos-btn px-2.5 py-1.5 text-xs"
              disabled={busy || wallet.status === "RESERVED"}
              onClick={onChangeStatus}
            >
              {wallet.status === "DISABLED" ? "Enable" : "Disable"}
            </button>
            <button
              className="rounded-xl px-2.5 py-1.5 text-xs text-kos-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
              disabled={busy || wallet.status === "RESERVED"}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={8} className="!bg-black/10">
            <WalletHistoryPanel wallet={wallet} orgSlug={orgSlug} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function WalletHistoryPanel({
  wallet,
  orgSlug,
}: {
  wallet: TeamWallet;
  orgSlug: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-kos-muted">
        Usage history
      </div>
      {wallet.history.length ? (
        <div className="space-y-2">
          {wallet.history.map((usage) => (
            <div
              key={usage.id}
              className="flex flex-col gap-1 rounded-xl border border-white/[0.07] p-2.5 text-xs sm:flex-row sm:items-center"
            >
              <Link
                href={`/${orgSlug}/raffles/${usage.raffleId}`}
                className="font-medium hover:text-blue-300"
              >
                #{usage.raffleId} · {usage.project}
              </Link>
              <span className="text-kos-muted">{usage.raffleTitle}</span>
              <span className="sm:ml-auto">{fmtDate(usage.reservedAt)}</span>
              <StatusBadge status={usage.status} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-kos-muted">
          This wallet has not been used in a raffle.
        </div>
      )}
    </div>
  );
}

function shortAddress(address: string): string {
  return address.length > 18
    ? `${address.slice(0, 8)}…${address.slice(-8)}`
    : address;
}
