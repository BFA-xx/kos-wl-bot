"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { motion } from "framer-motion";
import { Empty, PageTitle, SectionTitle, StatCard, TableShell } from "./ui";
import { CollabCreatePanel } from "./CollabCreatePanel";
import { PartnerMark, RaffleBanner } from "./CollabMedia";
import {
  IconChart,
  IconCheck,
  IconGrid,
  IconPlus,
  IconSearch,
  IconUsers,
} from "./icons";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import {
  collaborationBannerUrls,
  collaborationChainText,
  collaborationDescriptor,
} from "@/lib/collab-presentation";
import {
  COLLAB_PRIORITIES,
  COLLAB_PRIORITY_LABELS,
  COLLAB_STATUSES,
  COLLAB_STATUS_LABELS,
  collabStatusTone,
  displayCollabStatus,
  type CollabPriority,
  type CollabStatus,
} from "@/lib/collab-shared";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
}

interface CollabRow {
  id: string;
  projectName: string;
  status: CollabStatus;
  priority: CollabPriority;
  submissionStatus: string;
  whitelistAllocation: number;
  ownerId: string | null;
  assignedToId: string | null;
  reviewerId: string | null;
  hostAt: string | null;
  hostingDeadline: string | null;
  walletSubmissionDeadline: string | null;
  collaborationDeadline: string | null;
  followUpAt: string | null;
  updatedAt: string;
  partner: {
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    discordUrl: string | null;
    xUrl: string | null;
    chain: string | null;
    category: string | null;
    trustRating: number | null;
  };
  tags: { tag: { id: string; name: string; color: string } }[];
  raffles: {
    raffle: {
      id: number;
      projectName: string;
      status: string;
      title: string;
      bannerUrl: string | null;
      endAt: string;
      walletChains: string[];
    };
  }[];
  reminders: { id: string; title: string; type: string; dueAt: string }[];
  walletProgress: {
    total: number;
    collected: number;
    submitted: number;
    rejected: number;
    remaining: number;
    percent: number;
  };
}

interface HubData {
  collaborations: CollabRow[];
  summary: {
    active: number;
    hostingToday: number;
    waitingForWallets: number;
    readyForSubmission: number;
    completedAllTime: number;
    totalWlSpots: number;
    linkedRafflesAllTime: number;
    unlinkedRaffles: number;
  };
  team: Person[];
  tags: { id: string; name: string; color: string }[];
  savedFilters: {
    id: string;
    name: string;
    view: string;
    criteria: Record<string, string>;
  }[];
  recentActivity: {
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
    collaboration: { id: string; projectName: string };
  }[];
  recentNotes: {
    id: string;
    body: string;
    pinned: boolean;
    updatedAt: string;
    collaboration: { id: string; projectName: string };
  }[];
  reminders: {
    id: string;
    title: string;
    dueAt: string;
    type: string;
    collaboration: { id: string; projectName: string };
  }[];
  analytics: {
    total: number;
    successRate: number;
    averageCompletionDays: number;
    wlCollected: number;
    wlHosted: number;
    pendingSubmissions: number;
    topPartners: { name: string; count: number }[];
    topTeamMembers: { id: string; name: string; count: number }[];
    activityHistory: { key: string; label: string; value: number }[];
  };
}

interface ImportOptions {
  includeEmpty: boolean;
  includeCancelled: boolean;
  includeTests: boolean;
}

interface ImportPreview {
  totalUnlinked: number;
  defaultEligible: number;
  empty: number;
  cancelled: number;
  test: number;
  selected: number;
  groups: number;
}

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  includeEmpty: false,
  includeCancelled: false,
  includeTests: false,
};

interface Partner {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  discordUrl: string | null;
  xUrl: string | null;
  chain: string | null;
  category: string | null;
  trustRating: number | null;
  responseRate: number | null;
  privateNotes: string | null;
  contacts: { id: string; name: string; role: string | null }[];
  collaborations: {
    id: string;
    projectName: string;
    status: string;
    raffles: { raffle: { walletChains: string[] } }[];
  }[];
}

type View = "BOARD" | "TABLE" | "CALENDAR";
type HubMode = "WORKSPACE" | "PARTNERS";

const BOARD_STATUSES: CollabStatus[] = [
  "LEAD",
  "REACHED_OUT",
  "COMPLETED",
  ...COLLAB_STATUSES.filter(
    (status) => !["LEAD", "REACHED_OUT", "COMPLETED"].includes(status),
  ),
];

const TABLE_COLUMNS = [
  "project",
  "chain",
  "social",
  "spots",
  "status",
  "owner",
  "host",
  "wallets",
  "submission",
  "deadline",
  "priority",
  "updated",
] as const;
type TableColumn = (typeof TABLE_COLUMNS)[number];

export function CollabHub() {
  const { org } = useParams<{ org: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan(PERMISSIONS.COLLAB_CREATE);
  const canEdit = useCan(PERMISSIONS.COLLAB_EDIT);
  const canArchive = useCan(PERMISSIONS.COLLAB_ARCHIVE);
  const [mode, setMode] = useState<HubMode>("WORKSPACE");
  const [view, setView] = useState<View>("BOARD");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [owner, setOwner] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [showCreate, setShowCreate] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [importingHistory, setImportingHistory] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loadingImportPreview, setLoadingImportPreview] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptions>(
    DEFAULT_IMPORT_OPTIONS,
  );
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<TableColumn>>(
    () => new Set(TABLE_COLUMNS),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(
      `kos-collab-view:${org}`,
    ) as View | null;
    if (saved && ["BOARD", "TABLE", "CALENDAR"].includes(saved)) setView(saved);
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (!typing && event.key.toLowerCase() === "n" && canCreate)
        setShowCreate(true);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, org]);

  useEffect(() => {
    const incoming = searchParams.get("q") ?? "";
    if (incoming !== q) setQ(incoming);
    // Only react to URL navigation; local search typing should not rewrite it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function changeView(next: View) {
    setView(next);
    window.localStorage.setItem(`kos-collab-view:${org}`, next);
  }

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (owner) params.set("owner", owner);
    if (tag) params.set("tag", tag);
    params.set("sort", sort);
    params.set("direction", direction);
    return params.toString();
  }, [direction, owner, priority, q, sort, status, tag]);
  const { data, mutate, isLoading } = useSWR<HubData>(
    `/api/${org}/collaborations?${query}`,
    fetcher,
    { refreshInterval: 30_000, keepPreviousData: true },
  );
  const { data: partnerData } = useSWR<{ partners: Partner[] }>(
    mode === "PARTNERS"
      ? `/api/${org}/partners?q=${encodeURIComponent(q)}`
      : null,
    fetcher,
  );

  const teamById = new Map(
    (data?.team ?? []).map((person) => [person.id, person]),
  );
  const rows = data?.collaborations ?? [];

  async function changeStatus(id: string, nextStatus: CollabStatus) {
    if (!canEdit) return;
    setMessage(null);
    const res = await fetch(`/api/${org}/collaborations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? "Couldn't move that collaboration.");
      return;
    }
    setMessage(`Moved to ${COLLAB_STATUS_LABELS[nextStatus]}.`);
    await mutate();
  }

  async function bulk(action: "archive" | "status", nextStatus?: CollabStatus) {
    if (!selected.size) return;
    const res = await fetch(`/api/${org}/collaborations/bulk`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action, status: nextStatus }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(body.error ?? "Bulk action failed.");
    setSelected(new Set());
    setMessage(
      `${body.count} collaboration${body.count === 1 ? "" : "s"} updated.`,
    );
    await mutate();
  }

  function exportCsv() {
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      [
        "Project",
        "Chain",
        "Status",
        "WL spots",
        "Wallet progress",
        "Hosted by",
        "Host date",
        "Deadline",
        "Priority",
        "Updated",
      ],
      ...rows.map((row) => [
        row.projectName,
        collaborationChainText(row.raffles, row.partner.chain),
        displayCollabStatus(row.status),
        row.whitelistAllocation,
        `${row.walletProgress.collected}/${row.walletProgress.total}`,
        teamById.get(row.ownerId ?? "")?.name ?? "",
        row.hostAt ?? row.hostingDeadline ?? "",
        row.walletSubmissionDeadline ?? row.collaborationDeadline ?? "",
        COLLAB_PRIORITY_LABELS[row.priority],
        row.updatedAt,
      ]),
    ]
      .map((line) => line.map(escape).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `KOS-${org}-collaborations.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveFilter() {
    if (!saveName.trim()) return;
    const res = await fetch(`/api/${org}/collaborations/filters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: saveName,
        view,
        criteria: { q, status, priority, owner, tag, sort, direction },
      }),
    });
    if (res.ok) {
      setShowSave(false);
      setSaveName("");
      setMessage("Filter saved for your team.");
      mutate();
    }
  }

  async function loadImportPreview(options: ImportOptions) {
    setLoadingImportPreview(true);
    const params = new URLSearchParams();
    if (options.includeEmpty) params.set("includeEmpty", "1");
    if (options.includeCancelled) params.set("includeCancelled", "1");
    if (options.includeTests) params.set("includeTests", "1");
    try {
      const res = await fetch(
        `/api/${org}/collaborations/import-history?${params}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Couldn't preview raffle history.");
        return;
      }
      setImportPreview(body as ImportPreview);
    } catch {
      setMessage("Couldn't preview raffle history. Check your connection.");
    } finally {
      setLoadingImportPreview(false);
    }
  }

  function openImport() {
    const options = { ...DEFAULT_IMPORT_OPTIONS };
    setImportOptions(options);
    setImportPreview(null);
    setShowImport(true);
    void loadImportPreview(options);
  }

  function updateImportOption(key: keyof ImportOptions, checked: boolean) {
    const options = { ...importOptions, [key]: checked };
    setImportOptions(options);
    void loadImportPreview(options);
  }

  async function importHistory() {
    if (importingHistory) return;
    setImportingHistory(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/${org}/collaborations/import-history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(importOptions),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Couldn't import raffle history.");
        return;
      }
      setMessage(
        body.raffles
          ? `Imported ${body.raffles} raffles into ${body.collaborations} partner collaboration${body.collaborations === 1 ? "" : "s"}.`
          : "Raffle history is already up to date.",
      );
      setShowImport(false);
      await mutate();
    } catch {
      setMessage(
        "Couldn't import raffle history. Check your connection and try again.",
      );
    } finally {
      setImportingHistory(false);
    }
  }

  function applyFilter(criteria: Record<string, string>, savedView?: string) {
    setQ(criteria.q ?? "");
    setStatus(criteria.status ?? "");
    setPriority(criteria.priority ?? "");
    setOwner(criteria.owner ?? "");
    setTag(criteria.tag ?? "");
    setSort(criteria.sort ?? "updatedAt");
    setDirection(criteria.direction === "asc" ? "asc" : "desc");
    if (savedView && ["BOARD", "TABLE", "CALENDAR"].includes(savedView)) {
      changeView(savedView as View);
    }
  }

  return (
    <>
      {showCreate ? (
        <CollabCreatePanel
          team={data?.team ?? []}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/${org}/collabs/${id}`)}
        />
      ) : null}
      {showImport ? (
        <HistoryImportPanel
          preview={importPreview}
          options={importOptions}
          loading={loadingImportPreview}
          importing={importingHistory}
          onOption={updateImportOption}
          onImport={importHistory}
          onClose={() => setShowImport(false)}
        />
      ) : null}
      <PageTitle
        title="Collab Hub"
        subtitle="Your partnership pipeline, raffle handoffs, wallet collection, and long-term project relationships in one workspace."
        action={
          <>
            <button
              className={`kos-btn ${mode === "WORKSPACE" ? "border-blue-400/30 bg-blue-500/10" : ""}`}
              onClick={() => setMode("WORKSPACE")}
            >
              Workspace
            </button>
            <button
              className={`kos-btn ${mode === "PARTNERS" ? "border-blue-400/30 bg-blue-500/10" : ""}`}
              onClick={() => setMode("PARTNERS")}
            >
              Partner directory
            </button>
            {canCreate ? (
              <button
                className="kos-btn-primary"
                onClick={() => setShowCreate(true)}
              >
                <IconPlus /> New collaboration
              </button>
            ) : null}
          </>
        }
      />

      <div className="relative z-10 mb-6 rounded-3xl border border-white/[0.08] bg-[#0D0D0D]/95 p-3 shadow-xl backdrop-blur-2xl lg:sticky lg:top-[65px]">
        <div className="gap-3 xl:flex xl:items-center">
          <div className="flex min-w-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kos-muted" />
              <input
                ref={searchRef}
                className="kos-input h-11 pl-10 pr-12"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder={
                  mode === "PARTNERS"
                    ? "Search partners, contacts, chain…"
                    : "Search projects, contacts, Discord, tags…"
                }
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-kos-muted">
                /
              </span>
            </div>
            {mode === "WORKSPACE" ? (
              <button
                className="kos-btn h-11 shrink-0 px-3 text-xs xl:hidden"
                onClick={() => setShowMobileFilters((value) => !value)}
                aria-expanded={showMobileFilters}
              >
                Filters
                {[status, priority, owner, tag].filter(Boolean).length ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] text-white">
                    {[status, priority, owner, tag].filter(Boolean).length}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          {mode === "WORKSPACE" ? (
            <div
              className={`${showMobileFilters ? "grid" : "hidden"} mt-3 grid-cols-2 gap-2 sm:grid-cols-4 xl:mt-0 xl:flex xl:shrink-0`}
            >
              <select
                className="kos-input h-11 min-w-0 xl:w-44"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active pipeline</option>
                {COLLAB_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {COLLAB_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
              <select
                className="kos-input h-11 min-w-0 xl:w-36"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="">All priorities</option>
                {COLLAB_PRIORITIES.map((item) => (
                  <option key={item} value={item}>
                    {COLLAB_PRIORITY_LABELS[item]}
                  </option>
                ))}
              </select>
              <select
                className="kos-input h-11 min-w-0 xl:w-44"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
              >
                <option value="">Everyone</option>
                {(data?.team ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <select
                className="kos-input h-11 min-w-0 xl:w-40"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">All tags</option>
                {(data?.tags ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        {mode === "WORKSPACE" ? (
          <div className="mt-3 border-t border-white/[0.07] pt-3 sm:flex sm:items-center sm:gap-2">
            <div
              className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:shrink-0 sm:gap-2"
              role="group"
              aria-label="Collaboration view"
            >
              <ViewButton
                active={view === "BOARD"}
                onClick={() => changeView("BOARD")}
                icon={<IconGrid />}
                label="Board"
              />
              <ViewButton
                active={view === "TABLE"}
                onClick={() => changeView("TABLE")}
                icon={<IconChart />}
                label="Spreadsheet"
              />
              <ViewButton
                active={view === "CALENDAR"}
                onClick={() => changeView("CALENDAR")}
                icon={<IconUsers />}
                label="Calendar"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-0 sm:min-w-0 sm:flex-1">
              {(data?.savedFilters ?? []).map((filter) => (
                <button
                  key={filter.id}
                  className="kos-btn h-9 px-3 text-xs"
                  onClick={() => applyFilter(filter.criteria, filter.view)}
                >
                  {filter.name}
                </button>
              ))}
              <div className="relative">
                <button
                  className="kos-btn h-9 px-3 text-xs"
                  onClick={() => setShowSave((value) => !value)}
                >
                  Save filter
                </button>
                {showSave ? (
                  <div className="absolute left-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-white/[0.10] bg-[#151515] p-3 shadow-2xl">
                    <label className="kos-label">Filter name</label>
                    <input
                      autoFocus
                      className="kos-input"
                      value={saveName}
                      onChange={(event) => setSaveName(event.target.value)}
                      placeholder="e.g. Urgent submissions"
                    />
                    <button
                      className="kos-btn-primary mt-2 w-full"
                      onClick={saveFilter}
                    >
                      Save for team
                    </button>
                  </div>
                ) : null}
              </div>
              {canCreate && (data?.summary.unlinkedRaffles ?? 0) > 0 ? (
                <button
                  className="kos-btn h-9 px-3 text-xs"
                  onClick={openImport}
                  disabled={importingHistory}
                >
                  {importingHistory
                    ? "Importing…"
                    : `Import ${data?.summary.unlinkedRaffles ?? 0} previous raffles`}
                </button>
              ) : null}
              <button
                className="kos-btn ml-auto h-9 px-3 text-xs"
                onClick={exportCsv}
              >
                Export CSV
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {message ? (
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-blue-400/20 bg-blue-400/10 px-4 py-3 text-sm text-blue-100">
          <span>{message}</span>
          <button
            className="text-blue-200/70 hover:text-white"
            onClick={() => setMessage(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {mode === "PARTNERS" ? (
        <PartnerDirectory
          partners={partnerData?.partners ?? []}
          org={org}
          loading={!partnerData}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
            <button
              type="button"
              className={`rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${status === "ACTIVE" ? "ring-2 ring-blue-400" : ""}`}
              onClick={() => setStatus(status === "ACTIVE" ? "" : "ACTIVE")}
              aria-pressed={status === "ACTIVE"}
              aria-label="Filter the workspace to active collaborations"
            >
              <StatCard
                accent
                label="Active"
                value={data?.summary.active ?? "—"}
                hint={
                  status === "ACTIVE" ? "showing active" : "click to filter"
                }
              />
            </button>
            <StatCard
              label="Raffles"
              value={data?.summary.linkedRafflesAllTime ?? "—"}
              hint="connected records"
            />
            <StatCard
              label="Hosting today"
              value={data?.summary.hostingToday ?? "—"}
              hint="scheduled now"
            />
            <StatCard
              label="Waiting wallets"
              value={data?.summary.waitingForWallets ?? "—"}
              hint="needs collection"
            />
            <StatCard
              label="Ready"
              value={data?.summary.readyForSubmission ?? "—"}
              hint="for submission"
            />
            <StatCard
              label="Completed"
              value={data?.summary.completedAllTime ?? "—"}
              hint="all time"
            />
            <StatCard
              label="WL spots"
              value={data?.summary.totalWlSpots ?? "—"}
              hint="total collected"
            />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <ActivityPanel data={data} org={org} />
            <DeadlinePanel data={data} org={org} />
            <NotesPanel data={data} org={org} />
          </div>

          <div className="mt-8 flex items-end justify-between gap-4">
            <div>
              <SectionTitle>Pipeline workspace</SectionTitle>
              <p className="text-sm text-kos-muted">
                {rows.length} grouped collaboration
                {rows.length === 1 ? "" : "s"} in this view ·{" "}
                {data?.summary.linkedRafflesAllTime ?? "—"} connected raffles
                total
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isLoading ? (
                <span className="text-xs text-kos-muted">Refreshing…</span>
              ) : null}
              <Link href={`/${org}/raffles`} className="kos-btn h-9 text-xs">
                View all {data?.summary.linkedRafflesAllTime ?? ""} raffles
              </Link>
            </div>
          </div>

          <div className="mt-3">
            {!data && isLoading ? (
              <LoadingSkeleton />
            ) : rows.length === 0 ? (
              <Empty>
                <div className="flex flex-col items-center gap-4">
                  <p>
                    {q || status || priority || owner || tag
                      ? "No collaborations match these filters."
                      : "Your collaboration pipeline is empty. Add the first partner or bring in your previous raffle partners."}
                  </p>
                  {!q &&
                  !status &&
                  !priority &&
                  !owner &&
                  !tag &&
                  canCreate &&
                  (data?.summary.unlinkedRaffles ?? 0) > 0 ? (
                    <button
                      className="kos-btn-primary"
                      onClick={openImport}
                      disabled={importingHistory}
                    >
                      {importingHistory
                        ? "Importing raffle history…"
                        : `Import ${data?.summary.unlinkedRaffles ?? 0} previous raffles`}
                    </button>
                  ) : null}
                </div>
              </Empty>
            ) : view === "BOARD" ? (
              <Board
                rows={rows}
                org={org}
                teamById={teamById}
                canEdit={canEdit}
                onMove={changeStatus}
              />
            ) : view === "TABLE" ? (
              <Spreadsheet
                rows={rows}
                org={org}
                teamById={teamById}
                selected={selected}
                setSelected={setSelected}
                visible={visibleColumns}
                setVisible={setVisibleColumns}
                showColumns={showColumns}
                setShowColumns={setShowColumns}
                sort={sort}
                direction={direction}
                onSort={(field) => {
                  if (sort === field)
                    setDirection((value) => (value === "asc" ? "desc" : "asc"));
                  else {
                    setSort(field);
                    setDirection("asc");
                  }
                }}
                canArchive={canArchive}
                canEdit={canEdit}
                onBulk={bulk}
              />
            ) : (
              <CalendarView
                rows={rows}
                org={org}
                month={month}
                setMonth={setMonth}
              />
            )}
          </div>

          <AnalyticsPanel data={data} />
        </>
      )}

      {canCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          className="fixed bottom-5 right-5 z-20 flex h-13 items-center gap-2 rounded-2xl border border-blue-300/30 bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_60px_-20px_rgba(59,130,246,0.9)] transition-transform hover:-translate-y-0.5 lg:hidden"
        >
          <IconPlus /> New
        </button>
      ) : null}
    </>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`kos-btn h-9 min-w-0 justify-center px-2 text-xs sm:px-3 ${active ? "border-blue-400/30 bg-blue-500/12 text-blue-100" : ""}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ActivityPanel({ data, org }: { data?: HubData; org: string }) {
  return (
    <div className="kos-card p-4 sm:p-5">
      <SectionTitle>Recent activity</SectionTitle>
      <div className="space-y-1">
        {(data?.recentActivity ?? []).slice(0, 5).map((item) => (
          <Link
            key={item.id}
            href={`/${org}/collabs/${item.collaboration.id}`}
            className="flex gap-3 rounded-2xl p-2.5 transition-colors hover:bg-white/[0.04]"
          >
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="block truncate text-xs text-kos-muted">
                {item.collaboration.projectName} · {relative(item.createdAt)}
              </span>
            </span>
          </Link>
        ))}
        {data && data.recentActivity.length === 0 ? (
          <p className="py-5 text-sm text-kos-muted">
            Activity will appear here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DeadlinePanel({ data, org }: { data?: HubData; org: string }) {
  return (
    <div className="kos-card p-4 sm:p-5">
      <SectionTitle>Upcoming deadlines</SectionTitle>
      <div className="space-y-2">
        {(data?.reminders ?? []).slice(0, 5).map((item) => {
          const overdue = new Date(item.dueAt).getTime() < Date.now();
          return (
            <Link
              key={item.id}
              href={`/${org}/collabs/${item.collaboration.id}`}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.045]"
            >
              <div
                className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl text-[10px] font-semibold uppercase ${overdue ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
              >
                <span>
                  {new Date(item.dueAt).toLocaleDateString(undefined, {
                    month: "short",
                  })}
                </span>
                <span className="text-sm leading-none">
                  {new Date(item.dueAt).getDate()}
                </span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="truncate text-xs text-kos-muted">
                  {item.collaboration.projectName}
                </div>
              </div>
            </Link>
          );
        })}
        {data && data.reminders.length === 0 ? (
          <p className="py-5 text-sm text-kos-muted">No upcoming deadlines.</p>
        ) : null}
      </div>
    </div>
  );
}

function NotesPanel({ data, org }: { data?: HubData; org: string }) {
  return (
    <div className="kos-card p-4 sm:p-5">
      <SectionTitle>Recent notes</SectionTitle>
      <div className="space-y-2">
        {(data?.recentNotes ?? []).slice(0, 4).map((note) => (
          <Link
            key={note.id}
            href={`/${org}/collabs/${note.collaboration.id}?tab=notes`}
            className="block rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.045]"
          >
            <div className="flex items-center gap-2 text-xs text-kos-muted">
              {note.pinned ? (
                <span className="text-amber-300">Pinned</span>
              ) : null}
              <span className="truncate">{note.collaboration.projectName}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-5">{note.body}</p>
          </Link>
        ))}
        {data && data.recentNotes.length === 0 ? (
          <p className="py-5 text-sm text-kos-muted">
            Notes from your team will appear here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Board({
  rows,
  org,
  teamById,
  canEdit,
  onMove,
}: {
  rows: CollabRow[];
  org: string;
  teamById: Map<string, Person>;
  canEdit: boolean;
  onMove: (id: string, status: CollabStatus) => void;
}) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {BOARD_STATUSES.map((status) => {
          const items = rows.filter((row) => row.status === status);
          if (!items.length) return null;
          return (
            <section
              key={status}
              className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025]"
            >
              <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-kos-muted">
                  {COLLAB_STATUS_LABELS[status]}
                </span>
                <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-kos-muted">
                  {items.length}
                </span>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {items.map((row, index) => (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index * 0.025, 0.2) }}
                  >
                    <BoardCard
                      row={row}
                      org={org}
                      teamById={teamById}
                      compact
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="-mx-4 hidden overflow-x-auto px-4 pb-5 sm:-mx-6 sm:px-6 md:block lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-3">
          {BOARD_STATUSES.map((status) => {
            const items = rows.filter((row) => row.status === status);
            return (
              <div
                key={status}
                className="w-[285px] shrink-0 rounded-3xl border border-white/[0.08] bg-white/[0.025] p-2"
                onDragOver={(event) => canEdit && event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData(
                    "text/collaboration-id",
                  );
                  if (id) onMove(id, status);
                }}
              >
                <div className="flex items-center justify-between px-2 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-kos-muted">
                    {COLLAB_STATUS_LABELS[status]}
                  </span>
                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-kos-muted">
                    {items.length}
                  </span>
                </div>
                <div className="min-h-24 space-y-2">
                  {items.map((row, index) => (
                    <motion.div
                      key={row.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index * 0.025, 0.2) }}
                    >
                      <BoardCard
                        row={row}
                        org={org}
                        teamById={teamById}
                        draggable={canEdit}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BoardCard({
  row,
  org,
  teamById,
  compact = false,
  draggable = false,
}: {
  row: CollabRow;
  org: string;
  teamById: Map<string, Person>;
  compact?: boolean;
  draggable?: boolean;
}) {
  return (
    <Link
      href={`/${org}/collabs/${row.id}`}
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) =>
              event.dataTransfer.setData("text/collaboration-id", row.id)
          : undefined
      }
      className={
        compact
          ? "block overflow-hidden bg-[#151515] transition-colors hover:bg-white/[0.045]"
          : "block cursor-grab overflow-hidden rounded-2xl border border-white/[0.09] bg-[#171717] shadow-[0_14px_40px_-30px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:border-white/[0.16] active:cursor-grabbing"
      }
    >
      <ProjectBanner
        row={row}
        className={
          compact
            ? "aspect-[16/5] w-full border-b border-white/[0.07]"
            : "aspect-[16/7] w-full border-b border-white/[0.07]"
        }
      />
      <div className={compact ? "p-4" : "p-3.5"}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {row.projectName}
            </div>
            <div className="mt-0.5 truncate text-xs text-kos-muted">
              {collaborationDescriptor(row.raffles, row.partner) ||
                `${row.raffles.length} raffle${row.raffles.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <PriorityDot priority={row.priority} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {row.tags.slice(0, 3).map(({ tag }) => (
            <span
              key={tag.id}
              className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-kos-muted"
            >
              {tag.name}
            </span>
          ))}
          {compact ? (
            <span className="text-[11px] text-kos-muted">
              {row.raffles.length} raffle
              {row.raffles.length === 1 ? "" : "s"} · {row.whitelistAllocation}{" "}
              spots
            </span>
          ) : null}
        </div>
        {compact ? (
          <div className="mt-3 flex items-center justify-between text-[11px] text-kos-muted">
            <span>{formatShortDate(row.hostAt ?? row.hostingDeadline)}</span>
            <span>
              {row.walletProgress.collected}/{row.walletProgress.total} wallets
            </span>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-kos-muted">
                <span>Wallets</span>
                <span>
                  {row.walletProgress.collected}/{row.walletProgress.total}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                  style={{ width: `${row.walletProgress.percent}%` }}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-3 text-[11px] text-kos-muted">
              <span>{formatShortDate(row.hostAt ?? row.hostingDeadline)}</span>
              <span className="max-w-24 truncate">
                {teamById.get(row.assignedToId ?? row.ownerId ?? "")?.name ??
                  "Unassigned"}
              </span>
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

function Spreadsheet({
  rows,
  org,
  teamById,
  selected,
  setSelected,
  visible,
  setVisible,
  showColumns,
  setShowColumns,
  sort,
  direction,
  onSort,
  canArchive,
  canEdit,
  onBulk,
}: {
  rows: CollabRow[];
  org: string;
  teamById: Map<string, Person>;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  visible: Set<TableColumn>;
  setVisible: (value: Set<TableColumn>) => void;
  showColumns: boolean;
  setShowColumns: (value: boolean) => void;
  sort: string;
  direction: string;
  onSort: (field: string) => void;
  canArchive: boolean;
  canEdit: boolean;
  onBulk: (action: "archive" | "status", status?: CollabStatus) => void;
}) {
  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {selected.size ? (
          <>
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            {canEdit ? (
              <select
                className="kos-input h-9 w-auto py-1 text-xs"
                defaultValue=""
                onChange={(event) =>
                  event.target.value &&
                  onBulk("status", event.target.value as CollabStatus)
                }
              >
                <option value="">Move to…</option>
                {COLLAB_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {COLLAB_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            ) : null}
            {canArchive ? (
              <button
                className="kos-btn h-9 px-3 text-xs text-red-300"
                onClick={() => onBulk("archive")}
              >
                Archive
              </button>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-kos-muted">
            Select rows for bulk actions
          </span>
        )}
        <div className="relative ml-auto">
          <button
            className="kos-btn h-9 px-3 text-xs"
            onClick={() => setShowColumns(!showColumns)}
          >
            Columns
          </button>
          {showColumns ? (
            <div className="absolute right-0 top-full z-20 mt-2 grid w-64 grid-cols-2 gap-1 rounded-2xl border border-white/[0.10] bg-[#151515] p-3 shadow-2xl">
              {TABLE_COLUMNS.map((column) => (
                <label
                  key={column}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs capitalize hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={visible.has(column)}
                    onChange={() => {
                      const next = new Set(visible);
                      if (next.has(column)) next.delete(column);
                      else next.add(column);
                      setVisible(next);
                    }}
                  />
                  {column === "owner" ? "Hosted by" : column}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="kos-card p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
                aria-label={`Select ${row.projectName}`}
              />
              <Link
                href={`/${org}/collabs/${row.id}`}
                className="min-w-0 flex-1"
              >
                <div className="flex items-center gap-3">
                  <ProjectLogo row={row} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {row.projectName}
                    </div>
                    <div className="text-xs text-kos-muted">
                      {collaborationChainText(row.raffles, row.partner.chain) ||
                        "No chain"}{" "}
                      · {row.whitelistAllocation} spots
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <CollabBadge status={row.status} />
                  <span className="text-xs text-kos-muted">
                    Wallets {row.walletProgress.collected}/
                    {row.walletProgress.total}
                  </span>
                </div>
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <TableShell>
          <table className="kos-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(rows.map((row) => row.id)),
                      )
                    }
                    aria-label="Select all"
                  />
                </th>
                {visible.has("project") ? (
                  <Sortable
                    label="Project"
                    field="projectName"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("chain") ? <th>Chain</th> : null}
                {visible.has("social") ? <th>Links</th> : null}
                {visible.has("spots") ? (
                  <Sortable
                    label="WL spots"
                    field="whitelistAllocation"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("status") ? (
                  <Sortable
                    label="Status"
                    field="status"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("owner") ? <th>Hosted by</th> : null}
                {visible.has("host") ? (
                  <Sortable
                    label="Host date"
                    field="hostAt"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("wallets") ? <th>Wallet progress</th> : null}
                {visible.has("submission") ? <th>Submission</th> : null}
                {visible.has("deadline") ? (
                  <Sortable
                    label="Deadline"
                    field="walletSubmissionDeadline"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("priority") ? (
                  <Sortable
                    label="Priority"
                    field="priority"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
                {visible.has("updated") ? (
                  <Sortable
                    label="Updated"
                    field="updatedAt"
                    {...{ sort, direction, onSort }}
                  />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.projectName}`}
                    />
                  </td>
                  {visible.has("project") ? (
                    <td>
                      <Link
                        href={`/${org}/collabs/${row.id}`}
                        className="flex items-center gap-3"
                      >
                        <ProjectLogo row={row} />
                        <span className="min-w-0">
                          <span className="block max-w-44 truncate font-medium">
                            {row.projectName}
                          </span>
                          <span className="block max-w-44 truncate text-xs text-kos-muted">
                            {collaborationDescriptor(
                              row.raffles,
                              row.partner,
                            ) ||
                              `${row.raffles.length} raffle${row.raffles.length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                      </Link>
                    </td>
                  ) : null}
                  {visible.has("chain") ? (
                    <td className="text-kos-muted">
                      {collaborationChainText(row.raffles, row.partner.chain) ||
                        "—"}
                    </td>
                  ) : null}
                  {visible.has("social") ? (
                    <td>
                      <div className="flex gap-2 text-xs">
                        {row.partner.discordUrl ? (
                          <a
                            href={row.partner.discordUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-300"
                          >
                            Discord
                          </a>
                        ) : null}
                        {row.partner.xUrl ? (
                          <a
                            href={row.partner.xUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-300"
                          >
                            X
                          </a>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {visible.has("spots") ? (
                    <td>{row.whitelistAllocation}</td>
                  ) : null}
                  {visible.has("status") ? (
                    <td>
                      <CollabBadge status={row.status} />
                    </td>
                  ) : null}
                  {visible.has("owner") ? (
                    <td className="max-w-36 truncate text-kos-muted">
                      {teamById.get(row.ownerId ?? "")?.name ?? "—"}
                    </td>
                  ) : null}
                  {visible.has("host") ? (
                    <td className="whitespace-nowrap text-kos-muted">
                      {formatShortDate(row.hostAt ?? row.hostingDeadline)}
                    </td>
                  ) : null}
                  {visible.has("wallets") ? (
                    <td>
                      <div className="w-28">
                        <div className="flex justify-between text-[10px] text-kos-muted">
                          <span>
                            {row.walletProgress.collected}/
                            {row.walletProgress.total}
                          </span>
                          <span>{row.walletProgress.percent}%</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-white/[0.07]">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${row.walletProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  ) : null}
                  {visible.has("submission") ? (
                    <td className="text-xs text-kos-muted">
                      {row.submissionStatus.replaceAll("_", " ")}
                    </td>
                  ) : null}
                  {visible.has("deadline") ? (
                    <td className="whitespace-nowrap text-kos-muted">
                      {formatShortDate(
                        row.walletSubmissionDeadline ??
                          row.collaborationDeadline,
                      )}
                    </td>
                  ) : null}
                  {visible.has("priority") ? (
                    <td>
                      <span className="inline-flex items-center gap-2 text-xs">
                        <PriorityDot priority={row.priority} />
                        {COLLAB_PRIORITY_LABELS[row.priority]}
                      </span>
                    </td>
                  ) : null}
                  {visible.has("updated") ? (
                    <td className="whitespace-nowrap text-kos-muted">
                      {relative(row.updatedAt)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </div>
    </div>
  );
}

function Sortable({
  label,
  field,
  sort,
  direction,
  onSort,
}: {
  label: string;
  field: string;
  sort: string;
  direction: string;
  onSort: (field: string) => void;
}) {
  return (
    <th>
      <button
        className="flex items-center gap-1 hover:text-white"
        onClick={() => onSort(field)}
      >
        {label}
        {sort === field ? <span>{direction === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

function CalendarView({
  rows,
  org,
  month,
  setMonth,
}: {
  rows: CollabRow[];
  org: string;
  month: Date;
  setMonth: (date: Date) => void;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + days) / 7) * 7 },
    (_, index) => index - firstWeekday + 1,
  );
  const events = (day: number) => {
    const dateKey = new Date(year, monthIndex, day).toDateString();
    return rows.flatMap((row) => [
      ...(row.hostAt && new Date(row.hostAt).toDateString() === dateKey
        ? [{ row, label: "Host", tone: "blue" }]
        : []),
      ...(row.walletSubmissionDeadline &&
      new Date(row.walletSubmissionDeadline).toDateString() === dateKey
        ? [{ row, label: "Wallets", tone: "amber" }]
        : []),
      ...(row.collaborationDeadline &&
      new Date(row.collaborationDeadline).toDateString() === dateKey
        ? [{ row, label: "Deadline", tone: "red" }]
        : []),
      ...(row.followUpAt && new Date(row.followUpAt).toDateString() === dateKey
        ? [{ row, label: "Follow up", tone: "violet" }]
        : []),
      ...row.reminders
        .filter(
          (reminder) => new Date(reminder.dueAt).toDateString() === dateKey,
        )
        .map(() => ({ row, label: "Reminder", tone: "violet" })),
    ]);
  };
  const agenda = rows
    .flatMap((row) => [
      ...(row.hostAt
        ? [{ row, label: "Host", tone: "blue", date: new Date(row.hostAt) }]
        : []),
      ...(row.walletSubmissionDeadline
        ? [
            {
              row,
              label: "Wallets",
              tone: "amber",
              date: new Date(row.walletSubmissionDeadline),
            },
          ]
        : []),
      ...(row.collaborationDeadline
        ? [
            {
              row,
              label: "Deadline",
              tone: "red",
              date: new Date(row.collaborationDeadline),
            },
          ]
        : []),
      ...(row.followUpAt
        ? [
            {
              row,
              label: "Follow up",
              tone: "violet",
              date: new Date(row.followUpAt),
            },
          ]
        : []),
      ...row.reminders.map((reminder) => ({
        row,
        label: reminder.title || "Reminder",
        tone: "violet",
        date: new Date(reminder.dueAt),
      })),
    ])
    .filter(
      (event) =>
        event.date.getFullYear() === year &&
        event.date.getMonth() === monthIndex,
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  return (
    <div className="kos-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
        <button
          className="kos-btn h-9"
          onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
        >
          ←
        </button>
        <h3 className="font-semibold">
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h3>
        <button
          className="kos-btn h-9"
          onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
        >
          →
        </button>
      </div>
      <div className="space-y-2 p-3 md:hidden">
        {agenda.map((event, index) => (
          <Link
            key={`${event.row.id}-${event.label}-${event.date.toISOString()}-${index}`}
            href={`/${org}/collabs/${event.row.id}`}
            className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition-colors hover:bg-white/[0.05]"
          >
            <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-white/[0.05] text-[10px] uppercase text-kos-muted">
              <span>
                {event.date.toLocaleDateString(undefined, { month: "short" })}
              </span>
              <span className="text-sm font-semibold leading-none text-white">
                {event.date.getDate()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {event.row.projectName}
              </div>
              <div
                className={`mt-0.5 text-xs ${event.tone === "blue" ? "text-blue-300" : event.tone === "amber" ? "text-amber-300" : event.tone === "red" ? "text-red-300" : "text-violet-300"}`}
              >
                {event.label}
              </div>
            </div>
            <span className="text-kos-muted">→</span>
          </Link>
        ))}
        {agenda.length === 0 ? (
          <div className="py-10 text-center text-sm text-kos-muted">
            No collaboration dates this month.
          </div>
        ) : null}
      </div>
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-white/[0.08] bg-white/[0.02] text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-kos-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, index) => (
            <div
              key={index}
              className={`min-h-24 border-b border-r border-white/[0.06] p-1.5 sm:min-h-32 sm:p-2 ${day < 1 || day > days ? "bg-black/10" : ""}`}
            >
              {day >= 1 && day <= days ? (
                <>
                  <div className="mb-1 text-xs text-kos-muted">{day}</div>
                  <div className="space-y-1">
                    {events(day)
                      .slice(0, 4)
                      .map((event, eventIndex) => (
                        <Link
                          key={`${event.row.id}-${event.label}-${eventIndex}`}
                          href={`/${org}/collabs/${event.row.id}`}
                          title={`${event.label}: ${event.row.projectName}`}
                          className={`block truncate rounded-md px-1.5 py-1 text-[9px] sm:text-[10px] ${event.tone === "blue" ? "bg-blue-500/15 text-blue-200" : event.tone === "amber" ? "bg-amber-500/15 text-amber-200" : event.tone === "red" ? "bg-red-500/15 text-red-200" : "bg-violet-500/15 text-violet-200"}`}
                        >
                          {event.label} · {event.row.projectName}
                        </Link>
                      ))}
                  </div>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsPanel({ data }: { data?: HubData }) {
  const analytics = data?.analytics;
  const max = Math.max(
    1,
    ...(analytics?.topPartners.map((partner) => partner.count) ?? [1]),
  );
  return (
    <div className="mt-10">
      <SectionTitle>Collaboration analytics</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="kos-card grid grid-cols-2 gap-3 p-4 sm:p-5 lg:col-span-2 sm:grid-cols-3">
          <MiniMetric
            label="Success rate"
            value={`${analytics?.successRate ?? 0}%`}
          />
          <MiniMetric
            label="Avg completion"
            value={`${analytics?.averageCompletionDays ?? 0}d`}
          />
          <MiniMetric
            label="WL collected"
            value={analytics?.wlCollected ?? 0}
          />
          <MiniMetric label="WL hosted" value={analytics?.wlHosted ?? 0} />
          <MiniMetric
            label="Pending submits"
            value={analytics?.pendingSubmissions ?? 0}
          />
          <MiniMetric label="Total records" value={analytics?.total ?? 0} />
        </div>
        <div className="kos-card p-4 sm:p-5">
          <SectionTitle>Top partners</SectionTitle>
          <div className="space-y-3">
            {(analytics?.topPartners ?? []).map((partner) => (
              <div key={partner.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="truncate">{partner.name}</span>
                  <span className="text-kos-muted">{partner.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                    style={{ width: `${(partner.count / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {analytics && analytics.topPartners.length === 0 ? (
              <p className="text-sm text-kos-muted">
                Partner performance appears after records are added.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="kos-card p-4 sm:p-5">
          <SectionTitle>All-time activity</SectionTitle>
          <div className="overflow-x-auto pb-1">
            <div className="flex h-40 min-w-max items-end gap-3">
              {(analytics?.activityHistory ?? []).map((month) => {
                const monthlyMax = Math.max(
                  1,
                  ...(analytics?.activityHistory.map((item) => item.value) ?? [
                    1,
                  ]),
                );
                return (
                  <div
                    key={month.key}
                    className="flex h-full w-14 shrink-0 flex-col justify-end text-center"
                  >
                    <div className="mb-1 text-[10px] text-kos-muted">
                      {month.value}
                    </div>
                    <div
                      className="min-h-1 rounded-t-xl bg-gradient-to-t from-blue-600 to-violet-400 transition-all"
                      style={{
                        height: `${Math.max(4, (month.value / monthlyMax) * 100)}%`,
                      }}
                    />
                    <div className="mt-2 text-[10px] uppercase text-kos-muted">
                      {month.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="kos-card p-4 sm:p-5">
          <SectionTitle>Top performing teammates</SectionTitle>
          <div className="space-y-2">
            {(analytics?.topTeamMembers ?? []).map((member, index) => (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] p-3"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-xs text-kos-muted">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {member.name}
                </span>
                <span className="text-sm text-kos-muted">
                  {member.count} completed
                </span>
              </div>
            ))}
            {analytics && analytics.topTeamMembers.length === 0 ? (
              <p className="text-sm text-kos-muted">
                Completed collaborations will reveal team performance.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PartnerDirectory({
  partners,
  org,
  loading,
}: {
  partners: Partner[];
  org: string;
  loading: boolean;
}) {
  if (loading) return <LoadingSkeleton />;
  if (!partners.length)
    return <Empty>No partners match this search yet.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {partners.map((partner) => (
        <div key={partner.id} className="kos-card kos-card-hover p-5">
          <div className="flex items-start gap-3">
            <PartnerMark
              name={partner.name}
              src={partner.logoUrl}
              className="h-12 w-12 rounded-2xl text-sm"
            />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold">{partner.name}</h3>
              <p className="text-xs text-kos-muted">
                {collaborationDescriptor(
                  partner.collaborations.flatMap(
                    (collaboration) => collaboration.raffles,
                  ),
                  partner,
                ) || "No hosted chain yet"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">
                {partner.trustRating ? `${partner.trustRating}/5` : "—"}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-kos-muted">
                trust
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniMetric
              label="Collabs"
              value={partner.collaborations.length}
              compact
            />
            <MiniMetric
              label="Success"
              value={
                partner.responseRate === null ? "—" : `${partner.responseRate}%`
              }
              compact
            />
            <MiniMetric
              label="Contacts"
              value={partner.contacts.length}
              compact
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {partner.websiteUrl ? (
              <a
                className="kos-btn h-8 px-3 text-xs"
                href={partner.websiteUrl}
                target="_blank"
                rel="noreferrer"
              >
                Website
              </a>
            ) : null}
            {partner.discordUrl ? (
              <a
                className="kos-btn h-8 px-3 text-xs"
                href={partner.discordUrl}
                target="_blank"
                rel="noreferrer"
              >
                Discord
              </a>
            ) : null}
            {partner.xUrl ? (
              <a
                className="kos-btn h-8 px-3 text-xs"
                href={partner.xUrl}
                target="_blank"
                rel="noreferrer"
              >
                X
              </a>
            ) : null}
          </div>
          {partner.collaborations[0] ? (
            <Link
              href={`/${org}/collabs/${partner.collaborations[0].id}`}
              className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-xs text-kos-muted hover:text-white"
            >
              <span>Latest collaboration</span>
              <span>
                {displayCollabStatus(partner.collaborations[0].status)} →
              </span>
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ProjectBanner({
  row,
  className,
}: {
  row: CollabRow;
  className: string;
}) {
  const sources = collaborationBannerUrls(row.raffles);
  return (
    <RaffleBanner
      name={row.projectName}
      src={sources[0]}
      fallbackSources={sources.slice(1)}
      className={className}
    />
  );
}

function HistoryImportPanel({
  preview,
  options,
  loading,
  importing,
  onOption,
  onImport,
  onClose,
}: {
  preview: ImportPreview | null;
  options: ImportOptions;
  loading: boolean;
  importing: boolean;
  onOption: (key: keyof ImportOptions, checked: boolean) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const choices: {
    key: keyof ImportOptions;
    label: string;
    description: string;
    count: number;
  }[] = [
    {
      key: "includeEmpty",
      label: "Ended with no entries",
      description: "Attach for history without increasing WL allocation.",
      count: preview?.empty ?? 0,
    },
    {
      key: "includeCancelled",
      label: "Cancelled attempts",
      description:
        "Keep failed or replaced posting attempts in the audit trail.",
      count: preview?.cancelled ?? 0,
    },
    {
      key: "includeTests",
      label: "Test-named raffles",
      description:
        "Include records whose project or title contains test labels.",
      count: preview?.test ?? 0,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-import-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-white/[0.10] bg-[#121212] p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="history-import-title"
              className="text-xl font-semibold tracking-tight"
            >
              Import raffle history
            </h2>
            <p className="mt-1 text-sm leading-6 text-kos-muted">
              Preview what will become collaboration records. Existing entries,
              winners, proofs, and wallets remain linked to their original
              raffles.
            </p>
          </div>
          <button className="kos-btn h-9 px-3 text-xs" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ImportMetric label="Unlinked" value={preview?.totalUnlinked} />
          <ImportMetric label="Standard" value={preview?.defaultEligible} />
          <ImportMetric label="Selected" value={preview?.selected} accent />
          <ImportMetric label="Groups" value={preview?.groups} />
        </div>

        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-kos-muted">
            Optional history
          </div>
          <div className="mt-3 space-y-2">
            {choices.map((choice) => (
              <label
                key={choice.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 transition-colors hover:border-white/[0.14]"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-blue-500"
                  checked={options[choice.key]}
                  onChange={(event) =>
                    onOption(choice.key, event.target.checked)
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3 text-sm font-medium">
                    <span>{choice.label}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-kos-muted">
                      {choice.count}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-kos-muted">
                    {choice.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="kos-btn" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button
            className="kos-btn-primary"
            onClick={onImport}
            disabled={
              importing || loading || !preview || preview.selected === 0
            }
          >
            {importing
              ? "Importing…"
              : loading
                ? "Updating preview…"
                : `Import ${preview?.selected ?? 0} raffle${preview?.selected === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | undefined;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${accent ? "border-blue-400/25 bg-blue-500/10" : "border-white/[0.08] bg-white/[0.025]"}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-kos-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value ?? "—"}</div>
    </div>
  );
}

function ProjectLogo({ row }: { row: CollabRow }) {
  const sources = collaborationBannerUrls(row.raffles);
  return (
    <RaffleBanner
      name={row.projectName}
      src={sources[0]}
      fallbackSources={sources.slice(1)}
      compact
      className="h-10 w-16 shrink-0 rounded-xl border border-white/[0.09]"
    />
  );
}

function PriorityDot({ priority }: { priority: CollabPriority }) {
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${priority === "URGENT" ? "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.7)]" : priority === "HIGH" ? "bg-amber-400" : priority === "MEDIUM" ? "bg-blue-400" : "bg-zinc-500"}`}
      title={`${COLLAB_PRIORITY_LABELS[priority]} priority`}
    />
  );
}

function CollabBadge({ status }: { status: string }) {
  return (
    <span className={`kos-badge whitespace-nowrap ${collabStatusTone(status)}`}>
      {displayCollabStatus(status)}
    </span>
  );
}

function MiniMetric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.07] bg-white/[0.025] ${compact ? "p-2.5 text-center" : "p-3 sm:p-4"}`}
    >
      <div
        className={`${compact ? "text-base" : "text-xl sm:text-2xl"} font-semibold`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-kos-muted sm:text-[10px]">
        {label}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.035]"
        />
      ))}
    </div>
  );
}

function formatShortDate(value: string | null) {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function relative(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
