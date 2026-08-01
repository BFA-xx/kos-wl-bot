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
import { IconArrowDown, IconArrowUp, IconSearch } from "@/components/icons";

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

const CHAINS = ["ETHEREUM", "BASE", "ROBINHOOD", "SOLANA", "BITCOIN"];
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
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (deferredSearch.trim()) params.set("q", deferredSearch.trim());
    return params.toString();
  }, [deferredSearch, page]);
  const { data, error, isLoading, mutate } = useSWR<PoolData>(
    `/api/${slug}/team-wallets?${query}`,
    fetcher,
  );
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState("");
  const [defaultChain, setDefaultChain] = useState("ETHEREUM");
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

  useEffect(() => setPage(1), [deferredSearch]);
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
    if (!content.trim()) return;
    setBusy("import");
    setNotice(null);
    setImportErrors([]);
    const response = await fetch(`/api/${slug}/team-wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, defaultChain, ownerId }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setImportErrors(body.errors ?? []);
    if (!response.ok) {
      setNotice(body.error ?? "Wallets could not be added.");
      return;
    }
    setNotice(
      `${body.imported} wallet${body.imported === 1 ? "" : "s"} added${body.errors?.length ? ` · ${body.errors.length} skipped` : ""}.`,
    );
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

  if (error) return <Empty>{error.message}</Empty>;
  if (isLoading || !data) return <Empty>Loading Team Wallet Pool…</Empty>;
  const memberById = new Map(
    data.members.map((member) => [member.userId, member]),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Wallets" value={data.stats.total} />
        <StatCard label="Available" value={data.stats.available} />
        <StatCard label="Reserved" value={data.stats.reserved} />
        <StatCard label="Disabled" value={data.stats.disabled} />
        <StatCard label="Team Members" value={data.stats.totalTeamMembers} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
        <div className="kos-card p-4 sm:p-5">
          <SectionTitle
            action={
              <button
                type="button"
                className="kos-btn-primary"
                onClick={() => setShowImport((value) => !value)}
              >
                {showImport ? "Close" : "+ Add wallets"}
              </button>
            }
          >
            Wallets
          </SectionTitle>
          {showImport ? (
            <div className="mb-5 rounded-3xl border border-blue-400/15 bg-blue-500/[0.045] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="kos-label">Default chain</span>
                  <select
                    className="kos-input"
                    value={defaultChain}
                    onChange={(event) => setDefaultChain(event.target.value)}
                  >
                    {CHAINS.map((chain) => (
                      <option key={chain}>{chain}</option>
                    ))}
                  </select>
                </label>
                {data.viewer.canManageAll ? (
                  <label>
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
              </div>
              <label className="mt-3 block">
                <span className="kos-label">Paste addresses or CSV</span>
                <textarea
                  className="kos-input min-h-36 font-mono text-xs"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={
                    "One address per line, or CSV with chain,wallet_address"
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="kos-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose CSV/TXT
                </button>
                <button
                  type="button"
                  className="kos-btn-primary"
                  disabled={!content.trim() || busy === "import"}
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
          )}
          {data.pagination.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-sm text-kos-muted">
              <span>{data.pagination.total} wallets</span>
              <div className="flex gap-2">
                <button
                  className="kos-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </button>
                <button
                  className="kos-btn"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((value) => value + 1)}
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

          <div className="kos-card p-4">
            <SectionTitle>Selection settings</SectionTitle>
            <label>
              <span className="kos-label">Default mode</span>
              <select
                className="kos-input"
                value={selectionMode}
                disabled={!data.viewer.canManageAll}
                onChange={(event) =>
                  setSelectionMode(event.target.value as SelectionMode)
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
            <div className="mt-4 space-y-2">
              <div className="kos-label">Member priority</div>
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
                    {data.viewer.canManageAll ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${member.name} up`}
                          className="rounded-lg p-1.5 text-kos-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => movePriority(index, -1)}
                        >
                          <IconArrowUp width={15} height={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${member.name} down`}
                          className="rounded-lg p-1.5 text-kos-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                          disabled={index === priorityIds.length - 1}
                          onClick={() => movePriority(index, 1)}
                        >
                          <IconArrowDown width={15} height={15} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {data.viewer.canManageAll ? (
              <button
                type="button"
                className="kos-btn-primary mt-4 w-full"
                disabled={busy === "priority"}
                onClick={savePriority}
              >
                {busy === "priority" ? "Saving…" : "Save settings"}
              </button>
            ) : (
              <p className="mt-4 text-xs leading-5 text-kos-muted">
                Admins arrange priority. Round Robin remains the default fill
                mode.
              </p>
            )}
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

function WalletRows({
  wallet,
  orgSlug,
  expanded,
  busy,
  onToggleHistory,
  onChangeStatus,
  onDelete,
}: {
  wallet: TeamWallet;
  orgSlug: string;
  expanded: boolean;
  busy: boolean;
  onToggleHistory: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
}) {
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
        <td className="text-kos-muted">{wallet.chain}</td>
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
                      <span className="text-kos-muted">
                        {usage.raffleTitle}
                      </span>
                      <span className="sm:ml-auto">
                        {fmtDate(usage.reservedAt)}
                      </span>
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
          </td>
        </tr>
      ) : null}
    </>
  );
}

function shortAddress(address: string): string {
  return address.length > 18
    ? `${address.slice(0, 8)}…${address.slice(-8)}`
    : address;
}
