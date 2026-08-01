"use client";

import { upload as uploadBlob } from "@vercel/blob/client";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { NewRaffleModal } from "./NewRaffleModal";
import { PartnerMark } from "./CollabMedia";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconDoc,
  IconPlus,
  IconSearch,
  IconWallet,
} from "./icons";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import type { CollabStatus } from "@/lib/collab-shared";

const fetcher = (url: string) =>
  fetch(url).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Request failed.");
    return body;
  });

interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

interface CollabRow {
  id: string;
  projectName: string;
  status: CollabStatus;
  whitelistAllocation: number;
  fcfsSpots: number;
  documentUrl: string | null;
  requirements: string | null;
  assignedToId: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
  partner: {
    id: string;
    name: string;
    logoUrl: string | null;
    discordUrl: string | null;
    xUrl: string | null;
  };
  tags: { tag: { id: string; name: string; color: string } }[];
  attachments: Attachment[];
  raffles: {
    raffle: {
      id: number;
      projectName: string;
      title: string;
      status: string;
      spots: number;
      entryCount: number;
      endAt: string;
      proof: {
        messageLink: string | null;
        artifactsStoredAt: string | null;
      } | null;
      _count: { winners: number };
    };
  }[];
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
  team: Person[];
  tags: { id: string; name: string; color: string }[];
}

type SheetStatus =
  | "IDEAS"
  | "NOT_STARTED"
  | "READY"
  | "HOSTING"
  | "HOSTED"
  | "WALLETS_SUBMITTED"
  | "COMPLETED"
  | "CANCELLED";

const SHEET_STATUSES: SheetStatus[] = [
  "IDEAS",
  "NOT_STARTED",
  "READY",
  "HOSTING",
  "HOSTED",
  "WALLETS_SUBMITTED",
  "COMPLETED",
  "CANCELLED",
];

const STATUS_LABELS: Record<SheetStatus, string> = {
  IDEAS: "Ideas",
  NOT_STARTED: "Not Started",
  READY: "Ready",
  HOSTING: "Hosting",
  HOSTED: "Hosted",
  WALLETS_SUBMITTED: "Wallets Submitted",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_CANONICAL: Record<SheetStatus, CollabStatus> = {
  IDEAS: "LEAD",
  NOT_STARTED: "REACHED_OUT",
  READY: "CONFIRMED",
  HOSTING: "HOSTING",
  HOSTED: "COLLECTING_WALLETS",
  WALLETS_SUBMITTED: "SUBMITTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

function sheetStatus(status: CollabStatus): SheetStatus {
  if (status === "LEAD") return "IDEAS";
  if (status === "REACHED_OUT" || status === "NEGOTIATING")
    return "NOT_STARTED";
  if (status === "CONFIRMED" || status === "SCHEDULED") return "READY";
  if (status === "HOSTING") return "HOSTING";
  if (status === "COLLECTING_WALLETS" || status === "READY_FOR_SUBMISSION")
    return "HOSTED";
  if (status === "SUBMITTED") return "WALLETS_SUBMITTED";
  if (status === "COMPLETED") return "COMPLETED";
  return "CANCELLED";
}

function statusTone(status: SheetStatus): string {
  const tones: Record<SheetStatus, string> = {
    IDEAS: "border-violet-400/25 bg-violet-400/10 text-violet-200",
    NOT_STARTED: "border-zinc-400/20 bg-zinc-400/10 text-zinc-300",
    READY: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
    HOSTING: "border-blue-400/25 bg-blue-400/10 text-blue-200",
    HOSTED: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    WALLETS_SUBMITTED: "border-indigo-400/25 bg-indigo-400/10 text-indigo-200",
    COMPLETED: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    CANCELLED: "border-red-400/25 bg-red-400/10 text-red-200",
  };
  return tones[status];
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Open link";
  }
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

type SortKey =
  | "projectName"
  | "gtd"
  | "fcfs"
  | "host"
  | "status"
  | "winners"
  | "createdAt";

interface DraftRow {
  projectName: string;
  xUrl: string;
  discordUrl: string;
  documentUrl: string;
  gtd: number;
  fcfs: number;
  assignedToId: string;
  status: SheetStatus;
  notes: string;
}

const EMPTY_DRAFT: DraftRow = {
  projectName: "",
  xUrl: "",
  discordUrl: "",
  documentUrl: "",
  gtd: 0,
  fcfs: 0,
  assignedToId: "",
  status: "IDEAS",
  notes: "",
};

export function CollabHub() {
  const { org } = useParams<{ org: string }>();
  const canCreate = useCan(PERMISSIONS.COLLAB_CREATE);
  const canEdit = useCan(PERMISSIONS.COLLAB_EDIT);
  const canAssign = useCan(PERMISSIONS.COLLAB_ASSIGN);
  const canArchive = useCan(PERMISSIONS.COLLAB_ARCHIVE);
  const canExport = useCan(PERMISSIONS.COLLAB_EXPORT);
  const canCreateRaffle = useCan(PERMISSIONS.RAFFLE_CREATE);
  const { data, error, isLoading, mutate } = useSWR<HubData>(
    `/api/${org}/collaborations?sort=createdAt&direction=desc`,
    fetcher,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [hostFilter, setHostFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [raffleRow, setRaffleRow] = useState<CollabRow | null>(null);

  const teamById = useMemo(
    () => new Map((data?.team ?? []).map((person) => [person.id, person])),
    [data?.team],
  );

  const projects = useMemo(
    () =>
      [
        ...new Set((data?.collaborations ?? []).map((row) => row.projectName)),
      ].sort((a, b) => a.localeCompare(b)),
    [data?.collaborations],
  );

  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return [...(data?.collaborations ?? [])]
      .filter((row) => {
        const visibleStatus = sheetStatus(row.status);
        const host = row.assignedToId
          ? (teamById.get(row.assignedToId)?.name ?? "")
          : "";
        const searchable = [
          row.projectName,
          row.partner.xUrl,
          row.partner.discordUrl,
          row.documentUrl,
          row.requirements,
          host,
          ...row.tags.map(({ tag }) => tag.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return (
          (!normalized || searchable.includes(normalized)) &&
          (!statusFilter || visibleStatus === statusFilter) &&
          (!hostFilter || row.assignedToId === hostFilter) &&
          (!projectFilter || row.projectName === projectFilter) &&
          (!tagFilter || row.tags.some(({ tag }) => tag.id === tagFilter)) &&
          (!dateFilter || row.createdAt.slice(0, 10) === dateFilter)
        );
      })
      .sort((a, b) => {
        const hostName = (row: CollabRow) =>
          row.assignedToId ? (teamById.get(row.assignedToId)?.name ?? "") : "";
        const winners = (row: CollabRow) =>
          row.raffles.reduce(
            (total, link) => total + link.raffle._count.winners,
            0,
          );
        const value = (row: CollabRow): string | number => {
          if (sortKey === "projectName") return row.projectName.toLowerCase();
          if (sortKey === "gtd") return row.whitelistAllocation;
          if (sortKey === "fcfs") return row.fcfsSpots;
          if (sortKey === "host") return hostName(row).toLowerCase();
          if (sortKey === "status")
            return SHEET_STATUSES.indexOf(sheetStatus(row.status));
          if (sortKey === "winners") return winners(row);
          return new Date(row.createdAt).getTime();
        };
        const av = value(a);
        const bv = value(b);
        const result = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDirection === "asc" ? result : -result;
      });
  }, [
    data?.collaborations,
    dateFilter,
    hostFilter,
    projectFilter,
    search,
    sortDirection,
    sortKey,
    statusFilter,
    tagFilter,
    teamById,
  ]);

  const metrics = useMemo(() => {
    const all = data?.collaborations ?? [];
    return {
      total: all.length,
      hosting: all.filter((row) => sheetStatus(row.status) === "HOSTING")
        .length,
      hosted: all.filter((row) => sheetStatus(row.status) === "HOSTED").length,
      completed: all.filter((row) => sheetStatus(row.status) === "COMPLETED")
        .length,
    };
  }, [data?.collaborations]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      rows.length && rows.every((row) => current.has(row.id))
        ? new Set()
        : new Set(rows.map((row) => row.id)),
    );
  }

  async function updateRow(row: CollabRow, patch: Record<string, unknown>) {
    if (!canEdit) return;
    setBusy(row.id);
    setMessage(null);
    const response = await fetch(`/api/${org}/collaborations/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? "Could not save that change.");
    await mutate();
    setBusy(null);
  }

  async function createRow() {
    if (!draft.projectName.trim()) {
      setMessage("Project name is required.");
      return;
    }
    setBusy("new");
    setMessage(null);
    const response = await fetch(`/api/${org}/collaborations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName: draft.projectName,
        xUrl: draft.xUrl,
        discordUrl: draft.discordUrl,
        documentUrl: draft.documentUrl,
        whitelistAllocation: Number(draft.gtd),
        fcfsSpots: Number(draft.fcfs),
        assignedToId: draft.assignedToId || null,
        status: STATUS_CANONICAL[draft.status],
        requirements: draft.notes,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Could not add the collaboration.");
    } else {
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      setMessage("Collaboration added.");
      await mutate();
    }
    setBusy(null);
  }

  async function duplicateRow(row: CollabRow) {
    setBusy(row.id);
    const response = await fetch(`/api/${org}/collaborations/${row.id}`, {
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? "Could not duplicate the row.");
    else setMessage(`${row.projectName} duplicated.`);
    await mutate();
    setBusy(null);
  }

  async function archiveRow(row: CollabRow) {
    setBusy(row.id);
    const response = await fetch(`/api/${org}/collaborations/${row.id}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? "Could not archive the row.");
    else setMessage(`${row.projectName} archived.`);
    await mutate();
    setBusy(null);
  }

  async function deleteRow(row: CollabRow) {
    if (
      !window.confirm(
        `Permanently delete ${row.projectName}? Its raffles will stay in KOS, but this tracker row cannot be restored.`,
      )
    )
      return;
    setBusy(row.id);
    const response = await fetch(
      `/api/${org}/collaborations/${row.id}?permanent=1`,
      { method: "DELETE" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? "Could not delete the row.");
    else setMessage(`${row.projectName} deleted.`);
    await mutate();
    setBusy(null);
  }

  async function bulkAction(
    action: "archive" | "delete" | "assign" | "status",
    value?: string,
  ) {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      action === "delete" &&
      !window.confirm(
        `Permanently delete ${ids.length} selected collaboration${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBusy("bulk");
    const response = await fetch(`/api/${org}/collaborations/bulk`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids,
        action,
        ...(action === "assign" ? { assignedToId: value } : {}),
        ...(action === "status" && value
          ? { status: STATUS_CANONICAL[value as SheetStatus] }
          : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? "Bulk action failed.");
    else {
      setMessage(`${body.count} row${body.count === 1 ? "" : "s"} updated.`);
      setSelected(new Set());
      await mutate();
    }
    setBusy(null);
  }

  function exportSelected() {
    const chosen = (data?.collaborations ?? []).filter((row) =>
      selected.has(row.id),
    );
    if (!chosen.length) return;
    const header = [
      "Project",
      "Project X Link",
      "Discord Invite",
      "Collab Document",
      "GTD Spots",
      "FCFS Spots",
      "Host",
      "Status",
      "Winners",
      "Wallet Export",
      "Notes",
      "Created At",
    ];
    const lines = chosen.map((row) => {
      const winners = row.raffles.reduce(
        (total, link) => total + link.raffle._count.winners,
        0,
      );
      const walletState = row.exportedAt
        ? "Exported"
        : row.walletProgress.collected > 0
          ? "Ready"
          : "Pending";
      return [
        row.projectName,
        row.partner.xUrl,
        row.partner.discordUrl,
        row.documentUrl,
        row.whitelistAllocation,
        row.fcfsSpots,
        row.assignedToId ? teamById.get(row.assignedToId)?.name : "",
        STATUS_LABELS[sheetStatus(row.status)],
        winners,
        walletState,
        row.requirements,
        row.createdAt,
      ]
        .map(escapeCsv)
        .join(",");
    });
    const blob = new Blob(
      [[header.map(escapeCsv).join(","), ...lines].join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `KOS-collabs-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function uploadDocument(row: CollabRow, file?: File) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setMessage("Files must be 15 MB or smaller.");
      return;
    }
    setUploading(row.id);
    setMessage(null);
    const safeName =
      file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-100) || "file";
    try {
      const blob = await uploadBlob(
        `orgs/${org}/collaborations/${row.id}/${Date.now()}-${safeName}`,
        file,
        {
          access: "private",
          handleUploadUrl: `/api/${org}/collaborations/${row.id}/attachments`,
          contentType: file.type,
          multipart: file.size > 5 * 1024 * 1024,
        },
      );
      const response = await fetch(
        `/api/${org}/collaborations/${row.id}/attachments`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: blob.url, name: file.name }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Upload failed.");
      setMessage(`${file.name} attached.`);
      await mutate();
    } catch (uploadError) {
      setMessage(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(null);
    }
  }

  const allVisibleSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div className="min-w-0 space-y-4 pb-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 h-1 w-10 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Collab Hub
          </h1>
          <p className="mt-1 text-sm text-kos-muted">
            Every whitelist collaboration, one row at a time.
          </p>
        </div>
        {canCreate ? (
          <button
            className="kos-btn-primary h-10"
            onClick={() => setAdding(true)}
          >
            <IconPlus className="h-4 w-4" /> Add collaboration
          </button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm">
        <Metric label="Total" value={metrics.total} />
        <Metric label="Hosting" value={metrics.hosting} tone="text-blue-300" />
        <Metric label="Hosted" value={metrics.hosted} tone="text-amber-300" />
        <Metric
          label="Completed"
          value={metrics.completed}
          tone="text-emerald-300"
        />
        <span className="ml-auto text-xs text-kos-muted">
          {rows.length} visible
        </span>
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1.5fr)_repeat(5,minmax(130px,1fr))]">
          <label className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kos-muted" />
            <input
              className="kos-input h-10 pl-9"
              placeholder="Search collaborations…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            className="kos-input h-10"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {SHEET_STATUSES.map((item) => (
              <option key={item} value={item}>
                {STATUS_LABELS[item]}
              </option>
            ))}
          </select>
          <select
            className="kos-input h-10"
            value={hostFilter}
            onChange={(event) => setHostFilter(event.target.value)}
            aria-label="Filter by host"
          >
            <option value="">All hosts</option>
            {(data?.team ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select
            className="kos-input h-10"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="kos-input h-10"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            aria-label="Filter by created date"
          />
          <select
            className="kos-input h-10"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {(data?.tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {message ? (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-sm text-blue-100">
          <span>{message}</span>
          <button
            className="text-blue-200/70 hover:text-blue-100"
            onClick={() => setMessage(null)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}

      {selected.size ? (
        <BulkBar
          count={selected.size}
          team={data?.team ?? []}
          canEdit={canEdit}
          canAssign={canAssign}
          canArchive={canArchive}
          busy={busy === "bulk"}
          onStatus={(value) => bulkAction("status", value)}
          onAssign={(value) => bulkAction("assign", value)}
          onExport={exportSelected}
          onArchive={() => bulkAction("archive")}
          onDelete={() => bulkAction("delete")}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d0d0e]/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_80px_-52px_rgba(0,0,0,0.9)]">
        <div className="max-h-[calc(100dvh-290px)] min-h-[420px] overflow-auto overscroll-contain">
          <table className="w-full min-w-[1960px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-11" />
              <col className="w-[230px]" />
              <col className="w-[170px]" />
              <col className="w-[170px]" />
              <col className="w-[220px]" />
              <col className="w-[105px]" />
              <col className="w-[105px]" />
              <col className="w-[160px]" />
              <col className="w-[175px]" />
              <col className="w-[220px]" />
              <col className="w-[170px]" />
              <col className="w-[240px]" />
              <col className="w-[135px]" />
              <col className="w-[285px]" />
            </colgroup>
            <thead className="sticky top-0 z-30 bg-[#151516]/95 text-[10px] uppercase tracking-[0.15em] text-kos-muted backdrop-blur-xl">
              <tr>
                <th className="sticky left-0 z-40 border-b border-r border-white/[0.08] bg-[#151516] px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all visible rows"
                  />
                </th>
                <SortableHeader
                  label="Project"
                  sort="projectName"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                  sticky
                />
                <PlainHeader>Project X Link</PlainHeader>
                <PlainHeader>Discord Invite</PlainHeader>
                <PlainHeader>Collab Document</PlainHeader>
                <SortableHeader
                  label="GTD Spots"
                  sort="gtd"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="FCFS Spots"
                  sort="fcfs"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Host"
                  sort="host"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Status"
                  sort="status"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Winner List"
                  sort="winners"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <PlainHeader>Wallet Export</PlainHeader>
                <PlainHeader>Notes</PlainHeader>
                <SortableHeader
                  label="Created At"
                  sort="createdAt"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={toggleSort}
                />
                <th className="sticky right-0 z-40 border-b border-l border-white/[0.08] bg-[#151516] px-4 py-3">
                  Quick actions
                </th>
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <NewRow
                  draft={draft}
                  team={data?.team ?? []}
                  canAssign={canAssign}
                  busy={busy === "new"}
                  onChange={(patch) =>
                    setDraft((current) => ({ ...current, ...patch }))
                  }
                  onSave={createRow}
                  onCancel={() => {
                    setDraft(EMPTY_DRAFT);
                    setAdding(false);
                  }}
                />
              ) : null}
              {rows.map((row) => (
                <CollabTableRow
                  key={row.id}
                  row={row}
                  org={org}
                  team={data?.team ?? []}
                  selected={selected.has(row.id)}
                  busy={busy === row.id}
                  uploading={uploading === row.id}
                  canEdit={canEdit}
                  canCreate={canCreate}
                  canAssign={canAssign}
                  canArchive={canArchive}
                  canExport={canExport}
                  canCreateRaffle={canCreateRaffle}
                  onSelect={() => toggleSelected(row.id)}
                  onUpdate={(patch) => updateRow(row, patch)}
                  onUpload={(file) => uploadDocument(row, file)}
                  onCreateRaffle={() => setRaffleRow(row)}
                  onDuplicate={() => duplicateRow(row)}
                  onArchive={() => archiveRow(row)}
                  onDelete={() => deleteRow(row)}
                  onWalletExported={() =>
                    window.setTimeout(() => void mutate(), 1200)
                  }
                  teamById={teamById}
                />
              ))}
            </tbody>
          </table>

          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-kos-muted">
              Loading collaborations…
            </div>
          ) : error ? (
            <div className="flex min-h-64 items-center justify-center px-5 text-center text-sm text-red-300">
              {error.message || "Could not load collaborations."}
            </div>
          ) : !rows.length && !adding ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                <IconDoc className="text-blue-300" />
              </div>
              <p className="mt-4 font-medium">No collaborations found</p>
              <p className="mt-1 max-w-sm text-sm text-kos-muted">
                Add a row or clear the filters to bring your collaboration list
                into one place.
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.07] bg-white/[0.02] px-4 py-2 text-xs text-kos-muted">
          <span>Click a cell to edit · Enter saves · Tab moves across</span>
          <span>{data?.collaborations.length ?? 0} collaborations</span>
        </div>
      </div>

      {raffleRow ? (
        <NewRaffleModal
          onClose={() => setRaffleRow(null)}
          collaborationId={raffleRow.id}
          prefill={{
            projectName: raffleRow.projectName,
            description: raffleRow.requirements ?? undefined,
            externalUrl: raffleRow.partner.xUrl ?? undefined,
            spots: Math.max(
              1,
              raffleRow.whitelistAllocation + raffleRow.fcfsSpots,
            ),
          }}
        />
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "text-kos-fg",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs text-kos-muted">{label}</span>
    </span>
  );
}

function PlainHeader({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-white/[0.08] px-4 py-3">{children}</th>;
}

function SortableHeader({
  label,
  sort,
  active,
  direction,
  onSort,
  sticky = false,
}: {
  label: string;
  sort: SortKey;
  active: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  sticky?: boolean;
}) {
  return (
    <th
      className={`border-b border-white/[0.08] px-4 py-3 ${
        sticky
          ? "sticky left-11 z-40 border-r bg-[#151516] shadow-[8px_0_18px_-16px_rgba(0,0,0,0.9)]"
          : ""
      }`}
    >
      <button
        className="inline-flex items-center gap-1.5 hover:text-kos-fg"
        onClick={() => onSort(sort)}
      >
        {label}
        {active === sort ? (
          direction === "asc" ? (
            <IconArrowUp className="h-3 w-3" />
          ) : (
            <IconArrowDown className="h-3 w-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

function CollabTableRow({
  row,
  org,
  team,
  selected,
  busy,
  uploading,
  canEdit,
  canCreate,
  canAssign,
  canArchive,
  canExport,
  canCreateRaffle,
  onSelect,
  onUpdate,
  onUpload,
  onCreateRaffle,
  onDuplicate,
  onArchive,
  onDelete,
  onWalletExported,
  teamById,
}: {
  row: CollabRow;
  org: string;
  team: Person[];
  selected: boolean;
  busy: boolean;
  uploading: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canAssign: boolean;
  canArchive: boolean;
  canExport: boolean;
  canCreateRaffle: boolean;
  onSelect: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onUpload: (file?: File) => void;
  onCreateRaffle: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onWalletExported: () => void;
  teamById: Map<string, Person>;
}) {
  const status = sheetStatus(row.status);
  const winnerCount = row.raffles.reduce(
    (total, link) => total + link.raffle._count.winners,
    0,
  );
  const raffle = row.raffles[0]?.raffle;
  const walletState = row.exportedAt
    ? "Exported"
    : row.walletProgress.collected > 0
      ? "Ready"
      : "Pending";
  const host = row.assignedToId ? teamById.get(row.assignedToId) : null;
  return (
    <tr
      className={`group border-b border-white/[0.065] transition-colors hover:bg-white/[0.035] ${
        selected ? "bg-blue-500/[0.07]" : ""
      } ${busy ? "opacity-65" : ""}`}
    >
      <td className="sticky left-0 z-20 border-r border-white/[0.07] bg-[#101011] px-3 py-4 group-hover:bg-[#151516]">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${row.projectName}`}
        />
      </td>
      <td className="sticky left-11 z-20 border-r border-white/[0.07] bg-[#101011] px-4 py-4 shadow-[8px_0_18px_-16px_rgba(0,0,0,0.9)] group-hover:bg-[#151516]">
        <div className="flex min-w-0 items-center gap-3">
          <a
            href={row.partner.xUrl ?? undefined}
            target={row.partner.xUrl ? "_blank" : undefined}
            rel={row.partner.xUrl ? "noreferrer" : undefined}
            className="shrink-0"
            aria-label={`Open ${row.projectName} on X`}
          >
            <PartnerMark
              name={row.projectName}
              src={row.partner.logoUrl}
              className="h-9 w-9 rounded-xl"
            />
          </a>
          <div className="min-w-0 flex-1">
            <ProjectNameCell
              value={row.projectName}
              xUrl={row.partner.xUrl}
              disabled={!canEdit}
              onSave={(value) => onUpdate({ projectName: value })}
            />
            {row.tags.length ? (
              <div className="mt-1 truncate text-[10px] text-kos-muted">
                {row.tags.map(({ tag }) => tag.name).join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <InlineUrl
          value={row.partner.xUrl}
          label="Add X link"
          disabled={!canEdit}
          onSave={(value) => onUpdate({ xUrl: value })}
        />
      </td>
      <td className="px-4 py-4">
        <InlineUrl
          value={row.partner.discordUrl}
          label="Add invite"
          disabled={!canEdit}
          onSave={(value) => onUpdate({ discordUrl: value })}
        />
      </td>
      <td className="px-4 py-4">
        <DocumentCell
          row={row}
          org={org}
          disabled={!canEdit}
          uploading={uploading}
          onSave={(value) => onUpdate({ documentUrl: value })}
          onUpload={onUpload}
        />
      </td>
      <td className="px-4 py-4">
        <NumberCell
          value={row.whitelistAllocation}
          suffix="GTD"
          disabled={!canEdit}
          onSave={(value) => onUpdate({ whitelistAllocation: value })}
        />
      </td>
      <td className="px-4 py-4">
        <NumberCell
          value={row.fcfsSpots}
          suffix="FCFS"
          disabled={!canEdit}
          onSave={(value) => onUpdate({ fcfsSpots: value })}
        />
      </td>
      <td className="px-3 py-4">
        <select
          className="w-full rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm outline-none hover:border-white/[0.09] hover:bg-white/[0.035] focus:border-blue-400/50 focus:bg-[#151516] disabled:opacity-80"
          value={row.assignedToId ?? ""}
          disabled={!canEdit || !canAssign}
          onChange={(event) => onUpdate({ assignedToId: event.target.value })}
          aria-label={`Host for ${row.projectName}`}
        >
          <option value="">Unassigned</option>
          {team.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        {host?.role ? (
          <div className="px-2 text-[10px] text-kos-muted">{host.role}</div>
        ) : null}
      </td>
      <td className="px-3 py-4">
        <select
          className={`w-full rounded-xl border px-2.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 ${statusTone(status)}`}
          value={status}
          disabled={!canEdit}
          onChange={(event) =>
            onUpdate({
              status: STATUS_CANONICAL[event.target.value as SheetStatus],
            })
          }
          aria-label={`Status for ${row.projectName}`}
        >
          {SHEET_STATUSES.map((item) => (
            <option key={item} value={item}>
              {STATUS_LABELS[item]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-4">
        {raffle ? (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium tabular-nums">
                {winnerCount} winner{winnerCount === 1 ? "" : "s"}
              </span>
              <span className="h-1 w-1 rounded-full bg-kos-muted/50" />
              <span className="text-[10px] uppercase tracking-wider text-kos-muted">
                {raffle.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <a
                href={`/${org}/raffles/${raffle.id}`}
                className="text-blue-300 hover:text-blue-200"
              >
                View winners
              </a>
              {raffle.proof?.artifactsStoredAt && canExport ? (
                <a
                  href={`/api/${org}/collaborations/${row.id}/artifacts/${raffle.id}/csv`}
                  className="text-blue-300 hover:text-blue-200"
                >
                  CSV
                </a>
              ) : null}
              {raffle.proof?.messageLink ? (
                <a
                  href={raffle.proof.messageLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-300 hover:text-blue-200"
                >
                  Proof
                </a>
              ) : raffle.proof?.artifactsStoredAt ? (
                <a
                  href={`/api/${org}/collaborations/${row.id}/artifacts/${raffle.id}/pdf`}
                  className="text-blue-300 hover:text-blue-200"
                >
                  Proof
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-kos-muted">No raffle linked</span>
        )}
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              walletState === "Exported"
                ? "bg-indigo-400"
                : walletState === "Ready"
                  ? "bg-emerald-400"
                  : "bg-zinc-500"
            }`}
          />
          <span className="font-medium">{walletState}</span>
        </div>
        <div className="mt-1 text-[10px] text-kos-muted">
          {row.walletProgress.collected}/{row.walletProgress.total} collected
        </div>
        {row.walletProgress.collected > 0 && canExport ? (
          <a
            href={`/api/${org}/collaborations/${row.id}/wallets/export?format=csv`}
            className="mt-1 inline-flex text-xs text-blue-300 hover:text-blue-200"
            onClick={onWalletExported}
          >
            Download
          </a>
        ) : null}
      </td>
      <td className="px-3 py-4">
        <InlineText
          value={row.requirements ?? ""}
          placeholder="Add a note"
          disabled={!canEdit}
          multiline
          onSave={(value) => onUpdate({ requirements: value })}
        />
      </td>
      <td className="px-4 py-4 text-xs text-kos-muted">
        <time dateTime={row.createdAt}>{dateLabel(row.createdAt)}</time>
      </td>
      <td className="sticky right-0 z-20 border-l border-white/[0.07] bg-[#101011] px-3 py-4 group-hover:bg-[#151516]">
        <div className="flex items-center gap-1.5">
          {raffle ? (
            <a
              href={`/${org}/raffles/${raffle.id}`}
              className="rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-xs font-medium hover:bg-white/[0.07]"
            >
              Open raffle
            </a>
          ) : canCreateRaffle ? (
            <button
              className="rounded-xl border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-500/15"
              onClick={onCreateRaffle}
            >
              Create raffle
            </button>
          ) : null}
          {raffle && winnerCount > 0 ? (
            <a
              href={`/${org}/raffles/${raffle.id}`}
              className="rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-xs hover:bg-white/[0.07]"
            >
              Winners
            </a>
          ) : null}
          <details className="relative">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.035] text-lg text-kos-muted hover:bg-white/[0.07] hover:text-kos-fg">
              ···
            </summary>
            <div className="absolute bottom-full right-0 z-50 mb-2 w-48 overflow-hidden rounded-2xl border border-white/[0.10] bg-[#1a1a1c] p-1.5 shadow-2xl">
              {row.partner.xUrl ? (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
                  onClick={() => {
                    void navigator.clipboard.writeText(row.partner.xUrl!);
                  }}
                >
                  Copy project link
                </button>
              ) : null}
              <button
                className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-white/[0.06] disabled:opacity-40"
                onClick={onDuplicate}
                disabled={!canCreate}
              >
                Duplicate row
              </button>
              {row.walletProgress.collected > 0 && canExport ? (
                <a
                  className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
                  href={`/api/${org}/collaborations/${row.id}/wallets/export?format=csv`}
                  onClick={onWalletExported}
                >
                  Download wallets
                </a>
              ) : null}
              {canArchive ? (
                <>
                  <button
                    className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
                    onClick={onArchive}
                  >
                    Archive
                  </button>
                  <button
                    className="block w-full rounded-xl px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                    onClick={onDelete}
                  >
                    Delete permanently
                  </button>
                </>
              ) : null}
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}

function ProjectNameCell({
  value,
  xUrl,
  disabled,
  onSave,
}: {
  value: string;
  xUrl: string | null;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing && !disabled) {
    return (
      <input
        autoFocus
        className="w-full rounded-lg border border-blue-400/40 bg-black/30 px-2 py-1 font-medium outline-none"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      {xUrl ? (
        <a
          href={xUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate font-medium hover:text-blue-300"
        >
          {value}
        </a>
      ) : (
        <span className="truncate font-medium">{value}</span>
      )}
      {!disabled ? (
        <button
          className="shrink-0 text-[10px] text-kos-muted opacity-0 hover:text-kos-fg group-hover:opacity-100"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          aria-label={`Edit ${value}`}
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

function InlineText({
  value,
  placeholder,
  disabled,
  multiline = false,
  onSave,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const finish = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };
  if (!editing || disabled) {
    return (
      <button
        className={`block w-full rounded-xl px-2 py-2 text-left hover:bg-white/[0.035] ${
          value ? "text-kos-fg" : "text-kos-muted"
        }`}
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        <span className={multiline ? "line-clamp-2 leading-5" : "truncate"}>
          {value || placeholder}
        </span>
      </button>
    );
  }
  return multiline ? (
    <textarea
      autoFocus
      className="min-h-16 w-full resize-none rounded-xl border border-blue-400/40 bg-black/30 px-2.5 py-2 text-xs leading-5 outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  ) : (
    <input
      autoFocus
      className="w-full rounded-xl border border-blue-400/40 bg-black/30 px-2.5 py-2 outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

function InlineUrl({
  value,
  label,
  disabled,
  onSave,
}: {
  value: string | null;
  label: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  if (editing && !disabled) {
    return (
      <input
        autoFocus
        type="url"
        className="w-full rounded-xl border border-blue-400/40 bg-black/30 px-2.5 py-2 text-xs outline-none"
        placeholder="https://"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== (value ?? "")) onSave(draft.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      {value ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-xs text-blue-300 hover:text-blue-200"
        >
          {hostname(value)} ↗
        </a>
      ) : (
        <span className="truncate text-xs text-kos-muted">{label}</span>
      )}
      {!disabled ? (
        <button
          className="ml-auto shrink-0 rounded-lg px-1.5 py-1 text-[10px] text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

function NumberCell({
  value,
  suffix,
  disabled,
  onSave,
}: {
  value: number;
  suffix: string;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="flex items-center gap-1.5 rounded-xl border border-transparent px-2 py-2 hover:border-white/[0.08] hover:bg-white/[0.03] focus-within:border-blue-400/40 focus-within:bg-black/20">
      <input
        type="number"
        min={0}
        max={1_000_000}
        className="w-11 bg-transparent font-medium tabular-nums outline-none"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Math.max(0, Number.parseInt(draft || "0", 10));
          setDraft(String(next));
          if (next !== value) onSave(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
        aria-label={`${suffix} spots`}
      />
      <span className="text-[10px] text-kos-muted">{suffix}</span>
    </label>
  );
}

function DocumentCell({
  row,
  org,
  disabled,
  uploading,
  onSave,
  onUpload,
}: {
  row: CollabRow;
  org: string;
  disabled: boolean;
  uploading: boolean;
  onSave: (value: string) => void;
  onUpload: (file?: File) => void;
}) {
  const file = row.attachments[0];
  return (
    <div className="space-y-1.5">
      <InlineUrl
        value={row.documentUrl}
        label="Paste a document URL"
        disabled={disabled}
        onSave={onSave}
      />
      <div className="flex min-w-0 items-center gap-2 text-[10px]">
        {file ? (
          <a
            href={`/api/${org}/collaborations/${row.id}/attachments?attachmentId=${file.id}`}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-blue-300 hover:text-blue-200"
          >
            <IconDoc className="mr-1 inline h-3 w-3" />
            {file.name}
          </a>
        ) : (
          <span className="text-kos-muted">No uploaded file</span>
        )}
        {!disabled ? (
          <label className="ml-auto shrink-0 cursor-pointer text-kos-muted hover:text-kos-fg">
            {uploading ? "Uploading…" : "Upload"}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,image/*"
              disabled={uploading}
              onChange={(event) => onUpload(event.target.files?.[0])}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

function BulkBar({
  count,
  team,
  canEdit,
  canAssign,
  canArchive,
  busy,
  onStatus,
  onAssign,
  onExport,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  team: Person[];
  canEdit: boolean;
  canAssign: boolean;
  canArchive: boolean;
  busy: boolean;
  onStatus: (value: string) => void;
  onAssign: (value: string) => void;
  onExport: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky top-3 z-40 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-400/25 bg-[#17191e]/95 p-2.5 shadow-2xl backdrop-blur-xl">
      <span className="px-2 text-sm font-medium text-blue-100">
        {count} selected
      </span>
      {canEdit ? (
        <select
          className="kos-input h-9 w-auto min-w-40 py-1.5 text-xs"
          defaultValue=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) onStatus(event.target.value);
            event.target.value = "";
          }}
        >
          <option value="">Change status…</option>
          {SHEET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      ) : null}
      {canAssign ? (
        <select
          className="kos-input h-9 w-auto min-w-40 py-1.5 text-xs"
          defaultValue=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) onAssign(event.target.value);
            event.target.value = "";
          }}
        >
          <option value="">Assign host…</option>
          {team.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      ) : null}
      <button className="kos-btn h-9 px-3 text-xs" onClick={onExport}>
        Export rows
      </button>
      {canArchive ? (
        <>
          <button
            className="kos-btn h-9 px-3 text-xs"
            disabled={busy}
            onClick={onArchive}
          >
            Archive
          </button>
          <button
            className="h-9 rounded-xl px-3 text-xs text-red-300 hover:bg-red-500/10"
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </button>
        </>
      ) : null}
      <button
        className="ml-auto px-2 text-xs text-kos-muted hover:text-kos-fg"
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}

function NewRow({
  draft,
  team,
  canAssign,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: DraftRow;
  team: Person[];
  canAssign: boolean;
  busy: boolean;
  onChange: (patch: Partial<DraftRow>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const input =
    "w-full rounded-xl border border-white/[0.09] bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-blue-400/50";
  return (
    <tr className="border-b border-blue-400/20 bg-blue-500/[0.045]">
      <td className="sticky left-0 z-20 border-r border-white/[0.07] bg-[#11151b] px-3 py-4">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-500/20 text-blue-200">
          <IconPlus className="h-3 w-3" />
        </span>
      </td>
      <td className="sticky left-11 z-20 border-r border-white/[0.07] bg-[#11151b] px-3 py-4">
        <input
          autoFocus
          className={input}
          placeholder="Project name"
          value={draft.projectName}
          onChange={(event) => onChange({ projectName: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave();
            if (event.key === "Escape") onCancel();
          }}
        />
      </td>
      <td className="px-3 py-4">
        <input
          type="url"
          className={input}
          placeholder="https://x.com/…"
          value={draft.xUrl}
          onChange={(event) => onChange({ xUrl: event.target.value })}
        />
      </td>
      <td className="px-3 py-4">
        <input
          type="url"
          className={input}
          placeholder="Discord invite"
          value={draft.discordUrl}
          onChange={(event) => onChange({ discordUrl: event.target.value })}
        />
      </td>
      <td className="px-3 py-4">
        <input
          type="url"
          className={input}
          placeholder="Google Doc, Notion, PDF…"
          value={draft.documentUrl}
          onChange={(event) => onChange({ documentUrl: event.target.value })}
        />
      </td>
      <td className="px-3 py-4">
        <input
          type="number"
          min={0}
          className={input}
          value={draft.gtd}
          onChange={(event) => onChange({ gtd: Number(event.target.value) })}
        />
      </td>
      <td className="px-3 py-4">
        <input
          type="number"
          min={0}
          className={input}
          value={draft.fcfs}
          onChange={(event) => onChange({ fcfs: Number(event.target.value) })}
        />
      </td>
      <td className="px-3 py-4">
        <select
          className={input}
          value={draft.assignedToId}
          disabled={!canAssign}
          onChange={(event) => onChange({ assignedToId: event.target.value })}
        >
          <option value="">Unassigned</option>
          {team.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-4">
        <select
          className={input}
          value={draft.status}
          onChange={(event) =>
            onChange({ status: event.target.value as SheetStatus })
          }
        >
          {SHEET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-4 text-xs text-kos-muted">After raffle</td>
      <td className="px-4 py-4 text-xs text-kos-muted">Pending</td>
      <td className="px-3 py-4">
        <input
          className={input}
          placeholder="Add a note"
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </td>
      <td className="px-4 py-4 text-xs text-kos-muted">Now</td>
      <td className="sticky right-0 z-20 border-l border-white/[0.07] bg-[#11151b] px-3 py-4">
        <div className="flex gap-2">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-500 px-3 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
            disabled={busy}
            onClick={onSave}
          >
            <IconCheck className="h-3.5 w-3.5" /> Save row
          </button>
          <button
            className="h-9 rounded-xl px-3 text-xs text-kos-muted hover:bg-white/[0.05] hover:text-kos-fg"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
