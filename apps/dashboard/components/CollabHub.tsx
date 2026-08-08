"use client";

import { upload as uploadBlob } from "@vercel/blob/client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { NewRaffleModal } from "./NewRaffleModal";
import { PartnerMark, RaffleBanner } from "./CollabMedia";
import { ImageDrop } from "./ImageDrop";
import {
  IconArrowDown,
  IconArrowUp,
  IconCard,
  IconChart,
  IconCheck,
  IconDoc,
  IconGrid,
  IconPlus,
  IconSearch,
  IconTicket,
  IconUsers,
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
  priority: string;
  submissionStatus: string;
  whitelistAllocation: number;
  fcfsSpots: number;
  documentUrl: string | null;
  requirements: string | null;
  assignedToId: string | null;
  exportedAt: string | null;
  hostAt: string | null;
  walletSubmissionDeadline: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  partner: {
    id: string;
    name: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    websiteUrl: string | null;
    discordUrl: string | null;
    xUrl: string | null;
    bio: string | null;
    xVerified: boolean;
    chain: string | null;
    category: string | null;
  };
  tags: { tag: { id: string; name: string; color: string } }[];
  attachments: Attachment[];
  raffles: {
    raffle: {
      id: number;
      projectName: string;
      title: string;
      status: string;
      bannerUrl: string | null;
      spots: number;
      entryCount: number;
      endAt: string;
      walletChains: string[];
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
  summary?: {
    active: number;
    hostingToday: number;
    waitingForWallets: number;
    readyForSubmission: number;
    completedAllTime: number;
    totalWlSpots: number;
    linkedRafflesAllTime: number;
    unlinkedRaffles: number;
  };
  analytics?: {
    total: number;
    successRate: number;
    averageCompletionDays: number;
    wlCollected: number;
    wlHosted: number;
    pendingSubmissions: number;
  };
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
  logoUrl: string;
  bannerUrl: string;
  websiteUrl: string;
  bio: string;
  xVerified: boolean;
  discordUrl: string;
  documentUrl: string;
  gtd: number;
  fcfs: number;
  assignedToId: string;
  hostAt: string;
  status: SheetStatus;
  notes: string;
}

const EMPTY_DRAFT: DraftRow = {
  projectName: "",
  xUrl: "",
  logoUrl: "",
  bannerUrl: "",
  websiteUrl: "",
  bio: "",
  xVerified: false,
  discordUrl: "",
  documentUrl: "",
  gtd: 0,
  fcfs: 0,
  assignedToId: "",
  hostAt: "",
  status: "NOT_STARTED",
  notes: "",
};

type View = "TABLE" | "BOARD" | "CALENDAR";
type CalendarMode = "MONTH" | "WEEK" | "AGENDA";
type ColumnKey =
  | "project"
  | "x"
  | "discord"
  | "document"
  | "gtd"
  | "fcfs"
  | "host"
  | "status"
  | "winners"
  | "wallet"
  | "notes"
  | "hosting";

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  project: 300,
  x: 170,
  discord: 170,
  document: 220,
  gtd: 105,
  fcfs: 105,
  host: 160,
  status: 175,
  winners: 220,
  wallet: 170,
  notes: 240,
  hosting: 145,
};

interface XProfileMetadata {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  verified: boolean;
  profileUrl: string;
}

const BOARD_COLUMNS: {
  id: string;
  label: string;
  status: CollabStatus;
  tone: string;
}[] = [
  {
    id: "NOT_STARTED",
    label: "Not Started",
    status: "REACHED_OUT",
    tone: "from-zinc-400 to-zinc-600",
  },
  {
    id: "HOSTING",
    label: "Hosting",
    status: "HOSTING",
    tone: "from-blue-400 to-blue-600",
  },
  {
    id: "HOSTED",
    label: "Hosted",
    status: "COLLECTING_WALLETS",
    tone: "from-amber-300 to-orange-500",
  },
  {
    id: "WALLETS_SUBMITTED",
    label: "Wallet Submission",
    status: "SUBMITTED",
    tone: "from-violet-400 to-indigo-500",
  },
  {
    id: "COMPLETED",
    label: "Completed",
    status: "COMPLETED",
    tone: "from-emerald-300 to-emerald-600",
  },
];

function boardColumn(status: CollabStatus): string | null {
  const visible = sheetStatus(status);
  if (visible === "IDEAS" || visible === "NOT_STARTED" || visible === "READY")
    return "NOT_STARTED";
  if (visible === "HOSTING") return "HOSTING";
  if (visible === "HOSTED") return "HOSTED";
  if (visible === "WALLETS_SUBMITTED") return "WALLETS_SUBMITTED";
  if (visible === "COMPLETED") return "COMPLETED";
  return null;
}

function projectBanner(row: CollabRow): string | null {
  if (row.partner.bannerUrl) return row.partner.bannerUrl;
  const raffle = [...row.raffles].sort(
    (left, right) =>
      new Date(right.raffle.endAt).getTime() -
      new Date(left.raffle.endAt).getTime(),
  )[0];
  return raffle?.raffle.bannerUrl ?? null;
}

function xUsername(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return value.replace(/^@/u, "") || null;
  }
}

function rowChains(row: CollabRow): string[] {
  const configured = row.raffles.flatMap(
    ({ raffle }) => raffle.walletChains ?? [],
  );
  return [
    ...new Set([...configured, row.partner.chain].filter(Boolean)),
  ] as string[];
}

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
  const [view, setView] = useState<View>("TABLE");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("MONTH");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [raffleRow, setRaffleRow] = useState<CollabRow | null>(null);
  const [brandingRow, setBrandingRow] = useState<CollabRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(
      `kos-collab-view:${org}`,
    ) as View | null;
    if (saved && ["TABLE", "BOARD", "CALENDAR"].includes(saved)) {
      setView(saved);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
        target?.tagName ?? "",
      );
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "n" && !typing && canCreate) {
        event.preventDefault();
        setView("TABLE");
        setAdding(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCreate, org]);

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
          row.partner.name,
          row.partner.xUrl,
          row.partner.websiteUrl,
          row.partner.bio,
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
      waitingWallets: all.filter((row) =>
        ["COLLECTING_WALLETS", "READY_FOR_SUBMISSION"].includes(row.status),
      ).length,
      completed: all.filter((row) => sheetStatus(row.status) === "COMPLETED")
        .length,
      totalSpots: all.reduce(
        (total, row) =>
          total + row.whitelistAllocation + Math.max(0, row.fcfsSpots),
        0,
      ),
      averageDays: data?.analytics?.averageCompletionDays ?? 0,
    };
  }, [data?.analytics?.averageCompletionDays, data?.collaborations]);

  function changeView(next: View) {
    setView(next);
    window.localStorage.setItem(`kos-collab-view:${org}`, next);
  }

  function startColumnResize(
    column: ColumnKey,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(
        column === "project" ? 240 : 80,
        Math.min(520, startWidth + moveEvent.clientX - startX),
      );
      setColumnWidths((current) => ({ ...current, [column]: next }));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  }

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
    const previous = data;
    await mutate(
      (current) =>
        current
          ? {
              ...current,
              collaborations: current.collaborations.map((item) =>
                item.id === row.id
                  ? ({ ...item, ...patch } as CollabRow)
                  : item,
              ),
            }
          : current,
      false,
    );
    const response = await fetch(`/api/${org}/collaborations/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? "Could not save that change.");
      await mutate(previous, false);
    } else {
      await mutate();
    }
    setBusy(null);
  }

  async function createRow() {
    if (!draft.projectName.trim() && !draft.xUrl.trim()) {
      setMessage("Add a project name or paste its X profile.");
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
        logoUrl: draft.logoUrl,
        bannerUrl: draft.bannerUrl,
        websiteUrl: draft.websiteUrl,
        discordUrl: draft.discordUrl,
        documentUrl: draft.documentUrl,
        whitelistAllocation: Number(draft.gtd),
        fcfsSpots: Number(draft.fcfs),
        assignedToId: draft.assignedToId || null,
        status: STATUS_CANONICAL[draft.status],
        requirements: draft.notes,
        hostAt: draft.hostAt
          ? new Date(`${draft.hostAt}T12:00:00`).toISOString()
          : null,
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
      "Hosting Date",
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
        row.hostAt,
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
    <div data-testid="collab-hub-workspace" className="min-w-0 space-y-4 pb-10">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.09] bg-gradient-to-br from-[#171a24]/95 via-[#111113]/95 to-[#21162d]/90 p-5 shadow-[0_30px_100px_-58px_rgba(99,102,241,0.7)] sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 h-1 w-10 rounded-full bg-gradient-to-r from-blue-400 to-violet-400 shadow-[0_0_22px_rgba(96,165,250,0.65)]" />
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Collab Hub
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-kos-muted">
              Your visual spreadsheet for every partnership, raffle handoff,
              winner list, and wallet export.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher value={view} onChange={changeView} />
            {canCreate ? (
              <button
                className="kos-btn-primary h-10"
                onClick={() => {
                  changeView("TABLE");
                  setAdding(true);
                }}
              >
                <IconPlus className="h-4 w-4" /> Add collaboration
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        <MetricCard
          label="Total collaborations"
          value={metrics.total}
          icon={<IconGrid />}
          accent="from-blue-500 to-indigo-500"
          trend="All records"
        />
        <MetricCard
          label="Hosting"
          value={metrics.hosting}
          icon={<IconTicket />}
          accent="from-cyan-400 to-blue-500"
          trend="Live now"
        />
        <MetricCard
          label="Hosted"
          value={metrics.hosted}
          icon={<IconCheck />}
          accent="from-amber-300 to-orange-500"
          trend="Raffle ended"
        />
        <MetricCard
          label="Waiting for wallets"
          value={metrics.waitingWallets}
          icon={<IconWallet />}
          accent="from-violet-400 to-fuchsia-500"
          trend="Needs action"
        />
        <MetricCard
          label="Completed"
          value={metrics.completed}
          icon={<IconChart />}
          accent="from-emerald-300 to-emerald-600"
          trend="All time"
        />
        <MetricCard
          label="Total WL spots"
          value={metrics.totalSpots}
          icon={<IconUsers />}
          accent="from-indigo-400 to-violet-500"
          trend="GTD + FCFS"
        />
        <MetricCard
          label="Avg completion"
          value={`${metrics.averageDays}d`}
          icon={<IconCard />}
          accent="from-pink-400 to-rose-500"
          trend="Per collab"
        />
      </div>

      <section
        data-testid="collab-controls"
        className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1.5fr)_repeat(5,minmax(130px,1fr))]">
          <label className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kos-muted" />
            <input
              ref={searchRef}
              className="kos-input h-10 pl-9"
              placeholder="Search projects, X handles, hosts…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-kos-muted lg:block">
              /
            </span>
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

      {view === "TABLE" ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0d0d0e]/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_80px_-52px_rgba(0,0,0,0.9)]">
          <div className="max-h-[calc(100dvh-290px)] min-h-[420px] overflow-auto overscroll-contain">
            <table
              className="w-full table-fixed text-left text-sm"
              style={{
                minWidth:
                  44 +
                  285 +
                  Object.values(columnWidths).reduce(
                    (total, width) => total + width,
                    0,
                  ),
              }}
            >
              <colgroup>
                <col className="w-11" />
                {(
                  [
                    "project",
                    "x",
                    "discord",
                    "document",
                    "gtd",
                    "fcfs",
                    "host",
                    "status",
                    "winners",
                    "wallet",
                    "notes",
                    "hosting",
                  ] as ColumnKey[]
                ).map((column) => (
                  <col key={column} style={{ width: columnWidths[column] }} />
                ))}
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
                    column="project"
                    onResize={startColumnResize}
                  />
                  <PlainHeader column="x" onResize={startColumnResize}>
                    Project X Link
                  </PlainHeader>
                  <PlainHeader column="discord" onResize={startColumnResize}>
                    Discord Invite
                  </PlainHeader>
                  <PlainHeader column="document" onResize={startColumnResize}>
                    Collab Document
                  </PlainHeader>
                  <SortableHeader
                    label="GTD Spots"
                    sort="gtd"
                    active={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    column="gtd"
                    onResize={startColumnResize}
                  />
                  <SortableHeader
                    label="FCFS Spots"
                    sort="fcfs"
                    active={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    column="fcfs"
                    onResize={startColumnResize}
                  />
                  <SortableHeader
                    label="Host"
                    sort="host"
                    active={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    column="host"
                    onResize={startColumnResize}
                  />
                  <SortableHeader
                    label="Status"
                    sort="status"
                    active={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    column="status"
                    onResize={startColumnResize}
                  />
                  <SortableHeader
                    label="Winner List"
                    sort="winners"
                    active={sortKey}
                    direction={sortDirection}
                    onSort={toggleSort}
                    column="winners"
                    onResize={startColumnResize}
                  />
                  <PlainHeader column="wallet" onResize={startColumnResize}>
                    Wallet Export
                  </PlainHeader>
                  <PlainHeader column="notes" onResize={startColumnResize}>
                    Notes
                  </PlainHeader>
                  <PlainHeader column="hosting" onResize={startColumnResize}>
                    Hosting date
                  </PlainHeader>
                  <th className="sticky right-0 z-40 border-b border-l border-white/[0.08] bg-[#151516] px-4 py-3">
                    Quick actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {adding ? (
                  <NewRow
                    draft={draft}
                    org={org}
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
                    onEditBranding={() => setBrandingRow(row)}
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
                  Add a row or clear the filters to bring your collaboration
                  list into one place.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.07] bg-white/[0.02] px-4 py-2 text-xs text-kos-muted">
            <span>Click a cell to edit · Enter saves · Tab moves across</span>
            <span>{data?.collaborations.length ?? 0} collaborations</span>
          </div>
        </div>
      ) : view === "BOARD" ? (
        <BoardView
          rows={rows}
          org={org}
          canEdit={canEdit}
          teamById={teamById}
          onMove={(row, status) => updateRow(row, { status })}
        />
      ) : (
        <CalendarView
          rows={rows}
          org={org}
          mode={calendarMode}
          date={calendarDate}
          onModeChange={setCalendarMode}
          onDateChange={setCalendarDate}
        />
      )}

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
      {brandingRow ? (
        <BrandingOverrideModal
          row={brandingRow}
          org={org}
          onClose={() => setBrandingRow(null)}
          onSave={async (patch) => {
            await updateRow(brandingRow, patch);
            setBrandingRow(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ViewSwitcher({
  value,
  onChange,
}: {
  value: View;
  onChange: (view: View) => void;
}) {
  const views: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "TABLE", label: "Table", icon: <IconGrid className="h-3.5 w-3.5" /> },
    { id: "BOARD", label: "Board", icon: <IconCard className="h-3.5 w-3.5" /> },
    {
      id: "CALENDAR",
      label: "Calendar",
      icon: <IconChart className="h-3.5 w-3.5" />,
    },
  ];
  return (
    <div
      className="inline-flex rounded-2xl border border-white/[0.10] bg-black/25 p-1 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]"
      aria-label="Collaboration view"
    >
      {views.map((item) => (
        <button
          key={item.id}
          className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all sm:px-3 ${
            value === item.id
              ? "bg-white text-black shadow-lg"
              : "text-kos-muted hover:bg-white/[0.06] hover:text-white"
          }`}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  accent,
  trend,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
  trend: string;
}) {
  return (
    <div className="group relative min-h-28 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415]/90 p-3.5 shadow-[0_20px_50px_-40px_rgba(0,0,0,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.15] hover:bg-[#181819]">
      <div
        className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accent} opacity-80`}
      />
      <div className="flex items-start justify-between gap-2">
        <div
          className={`rounded-xl bg-gradient-to-br ${accent} p-2 text-white shadow-lg`}
        >
          {icon}
        </div>
        <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[9px] text-kos-muted">
          ↗ {trend}
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.13em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}

function PlainHeader({
  children,
  column,
  onResize,
}: {
  children: React.ReactNode;
  column?: ColumnKey;
  onResize?: (
    column: ColumnKey,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <th className="relative border-b border-white/[0.08] px-4 py-3">
      {children}
      {column && onResize ? (
        <ColumnResizeHandle column={column} onPointerDown={onResize} />
      ) : null}
    </th>
  );
}

function SortableHeader({
  label,
  sort,
  active,
  direction,
  onSort,
  sticky = false,
  column,
  onResize,
}: {
  label: string;
  sort: SortKey;
  active: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  sticky?: boolean;
  column?: ColumnKey;
  onResize?: (
    column: ColumnKey,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <th
      className={`border-b border-white/[0.08] px-4 py-3 ${
        sticky
          ? "sticky left-11 z-40 border-r bg-[#151516] shadow-[8px_0_18px_-16px_rgba(0,0,0,0.9)]"
          : "relative"
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
      {column && onResize ? (
        <ColumnResizeHandle column={column} onPointerDown={onResize} />
      ) : null}
    </th>
  );
}

function ColumnResizeHandle({
  column,
  onPointerDown,
}: {
  column: ColumnKey;
  onPointerDown: (
    column: ColumnKey,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <button
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
      onPointerDown={(event) => onPointerDown(column, event)}
      aria-label={`Resize ${column} column`}
      title="Drag to resize"
    >
      <span className="mx-auto block h-4 w-px bg-blue-300/70" />
    </button>
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
  onEditBranding,
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
  onEditBranding: () => void;
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
      className={`group border-b border-white/[0.065] even:bg-white/[0.012] transition-colors hover:bg-white/[0.045] ${
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
        <ProjectIdentityCell
          row={row}
          org={org}
          hostName={host?.name ?? "Unassigned"}
          disabled={!canEdit}
          onSave={(value) => onUpdate({ projectName: value })}
        />
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
          <div className="mt-1.5 flex gap-2 text-[10px]">
            {[
              ["CSV", "csv"],
              ["TXT", "txt"],
              ["Excel", "xlsx"],
            ].map(([label, format]) => (
              <a
                key={format}
                href={`/api/${org}/collaborations/${row.id}/wallets/export?format=${format}`}
                className="text-blue-300 hover:text-blue-200"
                onClick={onWalletExported}
              >
                {label}
              </a>
            ))}
          </div>
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
      <td className="px-3 py-4 text-xs text-kos-muted">
        <DateCell
          value={row.hostAt}
          disabled={!canEdit}
          onSave={(value) => onUpdate({ hostAt: value })}
        />
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
          {raffle?.proof?.messageLink ? (
            <a
              href={raffle.proof.messageLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-xs hover:bg-white/[0.07]"
            >
              Proof
            </a>
          ) : raffle?.proof?.artifactsStoredAt ? (
            <a
              href={`/api/${org}/collaborations/${row.id}/artifacts/${raffle.id}/pdf`}
              className="rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-xs hover:bg-white/[0.07]"
            >
              Proof
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
              {canEdit ? (
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-white/[0.06]"
                  onClick={onEditBranding}
                >
                  Edit project branding
                </button>
              ) : null}
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

function ProjectIdentityCell({
  row,
  org,
  hostName,
  disabled,
  onSave,
}: {
  row: CollabRow;
  org: string;
  hostName: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [preview, setPreview] = useState<{ top: number; left: number } | null>(
    null,
  );
  const closeTimer = useRef<number | null>(null);
  const handle = xUsername(row.partner.xUrl);
  const banner = projectBanner(row);
  const chains = rowChains(row);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setPreview(null), 110);
  };
  const openPreview = (element: HTMLElement) => {
    cancelClose();
    const rect = element.getBoundingClientRect();
    const width = 350;
    setPreview({
      top: Math.max(12, Math.min(rect.top - 20, window.innerHeight - 510)),
      left:
        rect.right + width + 18 <= window.innerWidth
          ? rect.right + 10
          : Math.max(12, rect.left - width - 10),
    });
  };

  return (
    <>
      <div
        className="flex min-w-0 items-center gap-3"
        onMouseEnter={(event) => openPreview(event.currentTarget)}
        onMouseLeave={scheduleClose}
        onFocus={(event) => openPreview(event.currentTarget)}
        onBlur={scheduleClose}
      >
        <div className="relative h-12 w-[74px] shrink-0 overflow-hidden rounded-xl border border-white/[0.09] bg-gradient-to-br from-blue-500/25 to-violet-500/20">
          {banner ? (
            <img
              src={banner}
              alt=""
              className="h-full w-full object-cover opacity-85"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          <PartnerMark
            name={row.projectName}
            src={row.partner.logoUrl}
            className="absolute bottom-1 left-1 h-7 w-7 rounded-lg border-black/30"
          />
        </div>
        <div className="min-w-0 flex-1">
          <ProjectNameCell
            value={row.projectName}
            xUrl={row.partner.xUrl}
            disabled={disabled}
            onSave={onSave}
          />
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-kos-muted">
            {handle ? <span className="truncate">@{handle}</span> : null}
            {row.partner.xVerified ? (
              <span
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold text-white"
                title="Verified on X"
              >
                ✓
              </span>
            ) : null}
            {chains[0] ? (
              <span className="shrink-0 rounded-full border border-white/[0.07] bg-white/[0.035] px-1.5 py-0.5">
                {chains[0]}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[10px] text-kos-muted">
            <span className="font-medium text-zinc-300">
              {row.whitelistAllocation} GTD
            </span>
            <span className="mx-1.5 text-white/20">·</span>
            <span>{row.fcfsSpots} FCFS</span>
          </div>
        </div>
      </div>
      {preview && typeof document !== "undefined"
        ? createPortal(
            <ProjectHoverPreview
              row={row}
              org={org}
              hostName={hostName}
              position={preview}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ProjectHoverPreview({
  row,
  org,
  hostName,
  position,
  onMouseEnter,
  onMouseLeave,
}: {
  row: CollabRow;
  org: string;
  hostName: string;
  position: { top: number; left: number };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const raffle = row.raffles[0]?.raffle;
  const winners = row.raffles.reduce(
    (sum, link) => sum + link.raffle._count.winners,
    0,
  );
  const handle = xUsername(row.partner.xUrl);
  return (
    <aside
      className="fixed z-[90] w-[350px] overflow-hidden rounded-[1.5rem] border border-white/[0.12] bg-[#171719]/98 shadow-[0_32px_100px_-28px_rgba(0,0,0,0.95)] backdrop-blur-2xl"
      style={position}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <RaffleBanner
        name={row.projectName}
        src={projectBanner(row)}
        compact
        className="h-28 w-full"
      />
      <div className="relative px-4 pb-4">
        <PartnerMark
          name={row.projectName}
          src={row.partner.logoUrl}
          className="-mt-6 h-14 w-14 rounded-2xl border-2 border-[#171719]"
        />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate font-semibold">{row.projectName}</h3>
              {row.partner.xVerified ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold">
                  ✓
                </span>
              ) : null}
            </div>
            {handle ? (
              <p className="text-xs text-kos-muted">@{handle}</p>
            ) : null}
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${statusTone(
              sheetStatus(row.status),
            )}`}
          >
            {STATUS_LABELS[sheetStatus(row.status)]}
          </span>
        </div>
        {row.partner.bio ? (
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-zinc-300">
            {row.partner.bio}
          </p>
        ) : null}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <PreviewStat label="GTD" value={row.whitelistAllocation} />
          <PreviewStat label="FCFS" value={row.fcfsSpots} />
          <PreviewStat label="Host" value={hostName} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.07] pt-3">
          {row.partner.xUrl ? (
            <a
              className="kos-btn h-8 px-3 text-xs"
              href={row.partner.xUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open X ↗
            </a>
          ) : null}
          {raffle ? (
            <Link
              className="kos-btn h-8 px-3 text-xs"
              href={`/${org}/raffles/${raffle.id}`}
            >
              Open raffle
            </Link>
          ) : null}
          {raffle && winners ? (
            <Link
              className="kos-btn h-8 px-3 text-xs"
              href={`/${org}/raffles/${raffle.id}`}
            >
              {winners} winner{winners === 1 ? "" : "s"}
            </Link>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function PreviewStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
      <div className="truncate text-xs font-semibold">{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wider text-kos-muted">
        {label}
      </div>
    </div>
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

function DateCell({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled: boolean;
  onSave: (value: string | null) => void;
}) {
  const dateValue = value ? new Date(value).toISOString().slice(0, 10) : "";
  const [draft, setDraft] = useState(dateValue);
  return (
    <label className="block rounded-xl border border-transparent px-2 py-2 hover:border-white/[0.08] hover:bg-white/[0.03] focus-within:border-blue-400/40 focus-within:bg-black/20">
      <input
        type="date"
        className="w-full bg-transparent text-xs outline-none"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === dateValue) return;
          onSave(draft ? new Date(`${draft}T12:00:00`).toISOString() : null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(dateValue);
            event.currentTarget.blur();
          }
        }}
        aria-label="Hosting date"
      />
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
  org,
  team,
  canAssign,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: DraftRow;
  org: string;
  team: Person[];
  canAssign: boolean;
  busy: boolean;
  onChange: (patch: Partial<DraftRow>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [metadataState, setMetadataState] = useState<
    "idle" | "loading" | "success" | "unavailable"
  >("idle");
  const lastFetched = useRef("");

  useEffect(() => {
    const xUrl = draft.xUrl.trim();
    if (
      !/(?:^|\.)x\.com\/[A-Za-z0-9_]{1,15}\/?(?:[?#].*)?$/iu.test(
        xUrl.replace(/^https?:\/\//iu, ""),
      ) ||
      lastFetched.current === xUrl
    ) {
      if (!xUrl) setMetadataState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMetadataState("loading");
      try {
        const response = await fetch(
          `/api/${org}/collaborations/x-profile?url=${encodeURIComponent(xUrl)}`,
          { signal: controller.signal },
        );
        const body = (await response.json().catch(() => ({}))) as {
          profile?: XProfileMetadata;
        };
        if (!response.ok || !body.profile) {
          setMetadataState("unavailable");
          return;
        }
        lastFetched.current = body.profile.profileUrl;
        onChange({
          projectName: draft.projectName.trim()
            ? draft.projectName
            : body.profile.displayName,
          xUrl: body.profile.profileUrl,
          logoUrl: body.profile.avatarUrl ?? "",
          bannerUrl: body.profile.bannerUrl ?? "",
          websiteUrl: body.profile.websiteUrl ?? "",
          bio: body.profile.bio ?? "",
          xVerified: body.profile.verified,
        });
        setMetadataState("success");
      } catch (metadataError) {
        if (
          !(metadataError instanceof DOMException) ||
          metadataError.name !== "AbortError"
        ) {
          setMetadataState("unavailable");
        }
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // This fetch is intentionally keyed only to the pasted X URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.xUrl, org]);

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
        <div>
          <input
            type="url"
            className={input}
            placeholder="https://x.com/…"
            value={draft.xUrl}
            onChange={(event) => onChange({ xUrl: event.target.value })}
          />
          {metadataState !== "idle" ? (
            <div
              className={`mt-1.5 flex items-center gap-1.5 text-[10px] ${
                metadataState === "success"
                  ? "text-emerald-300"
                  : metadataState === "unavailable"
                    ? "text-amber-300"
                    : "text-blue-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  metadataState === "loading"
                    ? "animate-pulse bg-blue-300"
                    : metadataState === "success"
                      ? "bg-emerald-300"
                      : "bg-amber-300"
                }`}
              />
              {metadataState === "loading"
                ? "Fetching project information…"
                : metadataState === "success"
                  ? "Project information added"
                  : "Continue manually"}
            </div>
          ) : null}
        </div>
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
        <span
          className={`inline-flex rounded-xl border px-2.5 py-2 text-xs font-medium ${statusTone("NOT_STARTED")}`}
        >
          Not Started
        </span>
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
      <td className="px-3 py-4">
        <input
          type="date"
          className={input}
          value={draft.hostAt}
          onChange={(event) => onChange({ hostAt: event.target.value })}
          aria-label="Hosting date"
        />
      </td>
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

function BoardView({
  rows,
  org,
  canEdit,
  teamById,
  onMove,
}: {
  rows: CollabRow[];
  org: string;
  canEdit: boolean;
  teamById: Map<string, Person>;
  onMove: (row: CollabRow, status: CollabStatus) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <section data-testid="collab-board" className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-sm font-semibold">Pipeline board</h2>
          <p className="mt-0.5 text-xs text-kos-muted">
            Drag a project to move the same spreadsheet row through its
            workflow.
          </p>
        </div>
        <span className="text-xs text-kos-muted">{rows.length} visible</span>
      </div>
      <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-5">
        {BOARD_COLUMNS.map((column) => {
          const items = rows.filter(
            (row) => boardColumn(row.status) === column.id,
          );
          return (
            <div
              key={column.id}
              className={`min-h-[360px] min-w-[260px] rounded-2xl border bg-[#111112]/85 p-2.5 transition-colors ${
                dragging
                  ? "border-blue-400/20 bg-blue-500/[0.025]"
                  : "border-white/[0.08]"
              }`}
              onDragOver={(event) => {
                if (canEdit) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id =
                  event.dataTransfer.getData("text/kos-collaboration") ||
                  dragging;
                const row = rows.find((item) => item.id === id);
                if (row && canEdit && boardColumn(row.status) !== column.id) {
                  void onMove(row, column.status);
                }
                setDragging(null);
              }}
            >
              <div className="mb-2.5 flex items-center justify-between px-1 py-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full bg-gradient-to-br ${column.tone}`}
                  />
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                    {column.label}
                  </h3>
                </div>
                <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2 py-0.5 text-[10px] text-kos-muted">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((row) => (
                  <BoardCard
                    key={row.id}
                    row={row}
                    org={org}
                    host={
                      row.assignedToId
                        ? (teamById.get(row.assignedToId) ?? null)
                        : null
                    }
                    draggable={canEdit}
                    dragging={dragging === row.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "text/kos-collaboration",
                        row.id,
                      );
                      setDragging(row.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                  />
                ))}
                {!items.length ? (
                  <div className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-white/[0.07] text-center text-[10px] text-kos-muted">
                    Drop a collaboration here
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BoardCard({
  row,
  org,
  host,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  row: CollabRow;
  org: string;
  host: Person | null;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181819] shadow-[0_18px_50px_-40px_rgba(0,0,0,0.95)] transition-all hover:-translate-y-0.5 hover:border-white/[0.16] hover:shadow-[0_22px_60px_-34px_rgba(59,130,246,0.28)] ${
        dragging ? "scale-[0.98] opacity-45" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <RaffleBanner
        name={row.projectName}
        src={projectBanner(row)}
        compact
        className="h-20 w-full transition-transform duration-500 group-hover:scale-[1.015]"
      />
      <Link
        href={`/${org}/collabs/${row.id}`}
        className="block p-3 focus:outline-none"
      >
        <div className="-mt-7 flex items-end justify-between gap-3">
          <PartnerMark
            name={row.projectName}
            src={row.partner.logoUrl}
            className="h-11 w-11 rounded-xl border-2 border-[#181819] shadow-lg"
          />
          <span
            className={`mb-1 rounded-full border px-2 py-1 text-[9px] font-medium ${statusTone(
              sheetStatus(row.status),
            )}`}
          >
            {STATUS_LABELS[sheetStatus(row.status)]}
          </span>
        </div>
        <div className="mt-2 truncate text-sm font-semibold">
          {row.projectName}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-kos-muted">
          {xUsername(row.partner.xUrl)
            ? `@${xUsername(row.partner.xUrl)}`
            : rowChains(row).join(" · ") || "Project profile"}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <PreviewStat label="GTD spots" value={row.whitelistAllocation} />
          <PreviewStat label="FCFS spots" value={row.fcfsSpots} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-2.5 text-[10px] text-kos-muted">
          <span className="truncate">
            {host ? `Hosted by ${host.name}` : "Host unassigned"}
          </span>
          <span className="tabular-nums">
            {row.walletProgress.collected}/{row.walletProgress.total} wallets
          </span>
        </div>
      </Link>
    </article>
  );
}

type CalendarEventTone = "blue" | "amber" | "emerald";

interface CollaborationCalendarEvent {
  id: string;
  date: Date;
  label: string;
  tone: CalendarEventTone;
  row: CollabRow;
}

function calendarEvents(rows: CollabRow[]): CollaborationCalendarEvent[] {
  return rows
    .flatMap((row) => {
      const events: CollaborationCalendarEvent[] = [];
      if (row.hostAt) {
        events.push({
          id: `${row.id}-hosting`,
          date: new Date(row.hostAt),
          label: "Hosting",
          tone: "blue",
          row,
        });
      }
      if (row.walletSubmissionDeadline) {
        events.push({
          id: `${row.id}-wallets`,
          date: new Date(row.walletSubmissionDeadline),
          label: "Wallet deadline",
          tone: "amber",
          row,
        });
      }
      row.raffles.forEach(({ raffle }) => {
        if (raffle.status === "ENDED") {
          events.push({
            id: `${row.id}-raffle-${raffle.id}`,
            date: new Date(raffle.endAt),
            label: "Raffle completed",
            tone: "emerald",
            row,
          });
        }
      });
      if (
        row.status === "COMPLETED" &&
        row.completedAt &&
        !events.some(
          (event) =>
            event.tone === "emerald" &&
            event.date.toDateString() ===
              new Date(row.completedAt!).toDateString(),
        )
      ) {
        events.push({
          id: `${row.id}-completed`,
          date: new Date(row.completedAt),
          label: "Completed",
          tone: "emerald",
          row,
        });
      }
      return events;
    })
    .filter((event) => !Number.isNaN(event.date.getTime()))
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfCalendarWeek(value: Date): Date {
  const start = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  );
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function CalendarView({
  rows,
  org,
  mode,
  date,
  onModeChange,
  onDateChange,
}: {
  rows: CollabRow[];
  org: string;
  mode: CalendarMode;
  date: Date;
  onModeChange: (mode: CalendarMode) => void;
  onDateChange: (date: Date) => void;
}) {
  const events = useMemo(() => calendarEvents(rows), [rows]);
  const byDay = useMemo(() => {
    const grouped = new Map<string, CollaborationCalendarEvent[]>();
    events.forEach((event) => {
      const key = dateKey(event.date);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    });
    return grouped;
  }, [events]);
  const weekStart = startOfCalendarWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    return day;
  });
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthGridStart = startOfCalendarWeek(firstOfMonth);
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(monthGridStart);
    day.setDate(day.getDate() + index);
    return day;
  });
  const label =
    mode === "WEEK"
      ? `${weekDays[0]!.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })} – ${weekDays[6]!.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`
      : date.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        });
  const navigate = (direction: number) => {
    const next = new Date(date);
    if (mode === "WEEK") next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    onDateChange(next);
  };

  return (
    <section
      data-testid="collab-calendar"
      className="overflow-hidden rounded-[1.5rem] border border-white/[0.09] bg-[#111112]/90 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.95)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] p-4 sm:px-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">
            Collaboration calendar
          </div>
          <h2 className="mt-0.5 text-lg font-semibold">{label}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/[0.08] bg-black/20 p-1">
            {(["MONTH", "WEEK", "AGENDA"] as CalendarMode[]).map((item) => (
              <button
                key={item}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                  mode === item
                    ? "bg-white text-black"
                    : "text-kos-muted hover:text-white"
                }`}
                onClick={() => onModeChange(item)}
              >
                {item[0]}
                {item.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <button
            className="kos-btn h-9 px-3 text-xs"
            onClick={() => onDateChange(new Date())}
          >
            Today
          </button>
          {mode !== "AGENDA" ? (
            <div className="inline-flex rounded-xl border border-white/[0.08] bg-black/20 p-1">
              <button
                className="h-7 w-8 rounded-lg text-kos-muted hover:bg-white/[0.05] hover:text-white"
                onClick={() => navigate(-1)}
                aria-label={
                  mode === "WEEK" ? "Previous week" : "Previous month"
                }
              >
                ←
              </button>
              <button
                className="h-7 w-8 rounded-lg text-kos-muted hover:bg-white/[0.05] hover:text-white"
                onClick={() => navigate(1)}
                aria-label={mode === "WEEK" ? "Next week" : "Next month"}
              >
                →
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {mode === "MONTH" ? (
        <>
          <div className="grid grid-cols-7 border-b border-white/[0.07] bg-white/[0.02] text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-kos-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="py-2.5">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const dayEvents = byDay.get(dateKey(day)) ?? [];
              const inMonth = day.getMonth() === date.getMonth();
              const today = dateKey(day) === dateKey(new Date());
              return (
                <div
                  key={dateKey(day)}
                  className={`min-h-24 border-b border-r border-white/[0.06] p-1.5 sm:min-h-32 sm:p-2 ${
                    inMonth ? "bg-white/[0.008]" : "bg-black/15 opacity-50"
                  }`}
                >
                  <div
                    className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-[10px] ${
                      today
                        ? "bg-blue-500 font-semibold text-white"
                        : "text-kos-muted"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <CalendarEventPill
                        key={event.id}
                        event={event}
                        org={org}
                        compact
                      />
                    ))}
                    {dayEvents.length > 3 ? (
                      <div className="px-1 text-[9px] text-kos-muted">
                        +{dayEvents.length - 3} more
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : mode === "WEEK" ? (
        <div className="grid min-h-[480px] grid-cols-1 divide-y divide-white/[0.06] sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {weekDays.map((day) => {
            const dayEvents = byDay.get(dateKey(day)) ?? [];
            return (
              <div key={dateKey(day)} className="min-w-0 p-2.5">
                <div className="mb-3 border-b border-white/[0.06] pb-2">
                  <div className="text-[9px] uppercase tracking-wider text-kos-muted">
                    {day.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold">
                    {day.getDate()}
                  </div>
                </div>
                <div className="space-y-2">
                  {dayEvents.map((event) => (
                    <CalendarEventCard key={event.id} event={event} org={org} />
                  ))}
                  {!dayEvents.length ? (
                    <div className="rounded-xl border border-dashed border-white/[0.06] px-2 py-5 text-center text-[9px] text-kos-muted">
                      No events
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/${org}/collabs/${event.row.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.035] sm:px-5"
            >
              <div className="w-16 shrink-0 text-center">
                <div className="text-lg font-semibold">
                  {event.date.getDate()}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-kos-muted">
                  {event.date.toLocaleDateString(undefined, {
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>
              <PartnerMark
                name={event.row.projectName}
                src={event.row.partner.logoUrl}
                className="h-10 w-10 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {event.row.projectName}
                </div>
                <div className="mt-0.5 text-xs text-kos-muted">
                  {event.label}
                </div>
              </div>
              <CalendarToneDot tone={event.tone} />
            </Link>
          ))}
          {!events.length ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <IconChart className="h-7 w-7 text-blue-300" />
              <p className="mt-3 text-sm font-medium">
                No scheduled events yet
              </p>
              <p className="mt-1 text-xs text-kos-muted">
                Hosting dates and wallet deadlines will appear automatically.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CalendarToneDot({ tone }: { tone: CalendarEventTone }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        tone === "blue"
          ? "bg-blue-400"
          : tone === "amber"
            ? "bg-amber-400"
            : "bg-emerald-400"
      }`}
    />
  );
}

function CalendarEventPill({
  event,
  org,
  compact,
}: {
  event: CollaborationCalendarEvent;
  org: string;
  compact?: boolean;
}) {
  const tone =
    event.tone === "blue"
      ? "border-blue-400/15 bg-blue-500/10 text-blue-200"
      : event.tone === "amber"
        ? "border-amber-400/15 bg-amber-500/10 text-amber-200"
        : "border-emerald-400/15 bg-emerald-500/10 text-emerald-200";
  return (
    <Link
      href={`/${org}/collabs/${event.row.id}`}
      title={`${event.label}: ${event.row.projectName}`}
      className={`block truncate rounded-md border px-1.5 py-1 ${
        compact ? "text-[8px] sm:text-[9px]" : "text-[10px]"
      } ${tone}`}
    >
      {event.label} · {event.row.projectName}
    </Link>
  );
}

function CalendarEventCard({
  event,
  org,
}: {
  event: CollaborationCalendarEvent;
  org: string;
}) {
  return (
    <Link
      href={`/${org}/collabs/${event.row.id}`}
      className="block rounded-xl border border-white/[0.07] bg-white/[0.025] p-2 transition-colors hover:border-white/[0.14] hover:bg-white/[0.045]"
    >
      <div className="flex items-center gap-2">
        <CalendarToneDot tone={event.tone} />
        <span className="text-[9px] font-medium text-kos-muted">
          {event.label}
        </span>
      </div>
      <div className="mt-1.5 truncate text-[10px] font-semibold">
        {event.row.projectName}
      </div>
    </Link>
  );
}

function BrandingOverrideModal({
  row,
  org,
  onClose,
  onSave,
}: {
  row: CollabRow;
  org: string;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [logoUrl, setLogoUrl] = useState(row.partner.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(row.partner.bannerUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshFromX() {
    if (!row.partner.xUrl) return;
    setFetching(true);
    setMessage(null);
    const response = await fetch(
      `/api/${org}/collaborations/x-profile?url=${encodeURIComponent(
        row.partner.xUrl,
      )}`,
    );
    const body = (await response.json().catch(() => ({}))) as {
      profile?: XProfileMetadata;
      error?: string;
    };
    if (body.profile) {
      setLogoUrl(body.profile.avatarUrl ?? logoUrl);
      setBannerUrl(body.profile.bannerUrl ?? bannerUrl);
      setMessage("Latest X branding is ready to save.");
    } else {
      setMessage(body.error ?? "Could not refresh the X profile.");
    }
    setFetching(false);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="max-h-[95dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] border border-white/[0.11] bg-[#151516] p-5 shadow-2xl sm:rounded-[2rem] sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${row.projectName} branding`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">
              Project branding
            </div>
            <h2 className="mt-1 text-xl font-semibold">{row.projectName}</h2>
            <p className="mt-1 text-xs leading-5 text-kos-muted">
              X branding fills automatically. Uploaded images always take
              priority.
            </p>
          </div>
          <button
            className="kos-btn h-9 w-9 p-0"
            onClick={onClose}
            aria-label="Close branding editor"
          >
            ×
          </button>
        </div>
        <div className="space-y-5">
          <ImageDrop
            label="Project logo or avatar"
            value={logoUrl}
            onChange={setLogoUrl}
          />
          <ImageDrop
            label="Project banner"
            value={bannerUrl}
            onChange={setBannerUrl}
          />
        </div>
        {message ? (
          <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs text-kos-muted">
            {message}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-4">
          {row.partner.xUrl ? (
            <button
              className="kos-btn h-9 px-3 text-xs"
              disabled={fetching || busy}
              onClick={refreshFromX}
            >
              {fetching ? "Fetching from X…" : "Refresh from X"}
            </button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button
              className="kos-btn h-9 px-3 text-xs"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="kos-btn-primary h-9 px-3 text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onSave({ logoUrl, bannerUrl });
                setBusy(false);
              }}
            >
              {busy ? "Saving…" : "Save branding"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
