"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { upload as uploadBlob } from "@vercel/blob/client";
import useSWR from "swr";
import { Empty, SectionTitle } from "./ui";
import { NewRaffleModal } from "./NewRaffleModal";
import {
  IconCheck,
  IconClose,
  IconDoc,
  IconPlus,
  IconTicket,
  IconUsers,
  IconWallet,
} from "./icons";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import {
  COLLAB_PRIORITIES,
  COLLAB_PRIORITY_LABELS,
  COLLAB_STATUSES,
  COLLAB_STATUS_LABELS,
  collabStatusTone,
  displayCollabStatus,
  type CollabStatus,
} from "@/lib/collab-shared";
import { WALLET_CHAINS } from "@/lib/wallet-validation";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

type Tab =
  | "overview"
  | "timeline"
  | "requirements"
  | "wallets"
  | "raffles"
  | "contacts"
  | "notes"
  | "files"
  | "activity"
  | "comments";

interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
  role?: string;
}

interface DetailData {
  collaboration: {
    id: string;
    projectName: string;
    status: CollabStatus;
    priority: string;
    submissionStatus: string;
    whitelistAllocation: number;
    requirements: string | null;
    primaryContactName: string | null;
    discordUsername: string | null;
    telegram: string | null;
    email: string | null;
    ownerId: string | null;
    assignedToId: string | null;
    reviewerId: string | null;
    hostAt: string | null;
    hostingDeadline: string | null;
    walletSubmissionDeadline: string | null;
    collaborationDeadline: string | null;
    followUpAt: string | null;
    noResponseDays: number;
    createdAt: string;
    updatedAt: string;
    exportedAt: string | null;
    partner: {
      id: string;
      name: string;
      logoUrl: string | null;
      websiteUrl: string | null;
      discordUrl: string | null;
      xUrl: string | null;
      chain: string | null;
      category: string | null;
      privateNotes: string | null;
      trustRating: number | null;
    };
    tags: { tag: { id: string; name: string; color: string } }[];
    wallets: {
      id: string;
      userId: string;
      chain: string | null;
      status: string;
      rejectionReason: string | null;
      submittedAt: string | null;
      user: {
        username: string;
        globalName: string | null;
        avatarUrl: string | null;
      };
    }[];
    raffles: {
      id: string;
      raffle: {
        id: number;
        projectName: string;
        title: string;
        status: string;
        spots: number;
        entryCount: number;
        endAt: string;
        bannerUrl: string | null;
        externalUrl: string | null;
        proof: {
          messageLink: string | null;
          generatedAt: string;
          artifactsStoredAt: string | null;
        } | null;
        _count: { winners: number };
      };
    }[];
    contacts: {
      id: string;
      name: string;
      role: string | null;
      discord: string | null;
      telegram: string | null;
      xUrl: string | null;
      email: string | null;
      notes: string | null;
      conversation: string | null;
      isPrimary: boolean;
    }[];
    notes: {
      id: string;
      authorId: string;
      body: string;
      pinned: boolean;
      createdAt: string;
      updatedAt: string;
    }[];
    comments: {
      id: string;
      authorId: string;
      body: string;
      mentionedUserIds: string[];
      createdAt: string;
      updatedAt: string;
    }[];
    attachments: {
      id: string;
      name: string;
      mimeType: string | null;
      size: number | null;
      kind: string | null;
      uploadedById: string;
      createdAt: string;
    }[];
    activities: {
      id: string;
      actorId: string | null;
      action: string;
      title: string;
      body: string | null;
      createdAt: string;
    }[];
    reminders: {
      id: string;
      type: string;
      title: string;
      dueAt: string;
      completedAt: string | null;
      automatic: boolean;
    }[];
  };
  team: Person[];
  people: Person[];
  availableRaffles: {
    id: number;
    projectName: string;
    title: string;
    status: string;
    spots: number;
    endAt: string;
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

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "requirements", label: "Requirements" },
  { id: "wallets", label: "Wallet collection" },
  { id: "raffles", label: "Raffles & proof" },
  { id: "contacts", label: "Contacts" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
  { id: "comments", label: "Comments" },
];

export function CollabDetail() {
  const { org, id } = useParams<{ org: string; id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    TABS.some((item) => item.id === initialTab) ? initialTab! : "overview",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [showRaffle, setShowRaffle] = useState(false);
  const canEdit = useCan(PERMISSIONS.COLLAB_EDIT);
  const canAssign = useCan(PERMISSIONS.COLLAB_ASSIGN);
  const canExport = useCan(PERMISSIONS.COLLAB_EXPORT);
  const canArchive = useCan(PERMISSIONS.COLLAB_ARCHIVE);
  const canCreateRaffle = useCan(PERMISSIONS.RAFFLE_CREATE);
  const { data, mutate, error } = useSWR<DetailData>(
    `/api/${org}/collaborations/${id}`,
    fetcher,
    {
      refreshInterval: 30_000,
    },
  );
  const people = useMemo(
    () =>
      new Map(
        [...(data?.team ?? []), ...(data?.people ?? [])].map((person) => [
          person.id,
          person,
        ]),
      ),
    [data],
  );

  async function patch(body: Record<string, unknown>, success: string) {
    const res = await fetch(`/api/${org}/collaborations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(response.error ?? "Couldn't save changes.");
      return false;
    }
    setMessage(success);
    await mutate();
    return true;
  }

  async function archive() {
    if (!canArchive) return;
    const res = await fetch(`/api/${org}/collaborations/${id}`, {
      method: "DELETE",
    });
    if (res.ok) router.push(`/${org}/collabs`);
    else setMessage("Couldn't archive this collaboration.");
  }

  if (error) return <Empty>Could not load this collaboration.</Empty>;
  if (!data) return <DetailSkeleton />;
  const collaboration = data.collaboration;

  return (
    <>
      {showRaffle ? (
        <NewRaffleModal
          collaborationId={collaboration.id}
          prefill={{
            projectName: collaboration.projectName,
            description: collaboration.requirements ?? undefined,
            bannerUrl: collaboration.partner.logoUrl ?? undefined,
            externalUrl: collaboration.partner.websiteUrl ?? undefined,
            spots: Math.max(1, collaboration.whitelistAllocation),
          }}
          onClose={() => setShowRaffle(false)}
        />
      ) : null}

      <Link
        href={`/${org}/collabs`}
        className="mb-4 inline-flex items-center gap-2 text-sm text-kos-muted hover:text-white"
      >
        ← Back to Collab Hub
      </Link>
      <div className="overflow-hidden rounded-[2rem] border border-white/[0.09] bg-gradient-to-br from-white/[0.06] via-white/[0.025] to-transparent shadow-[0_32px_100px_-60px_rgba(59,130,246,0.65)]">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.05] text-lg font-bold sm:h-20 sm:w-20">
                {collaboration.partner.logoUrl ? (
                  <img
                    src={collaboration.partner.logoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  collaboration.projectName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`kos-badge ${collabStatusTone(collaboration.status)}`}
                  >
                    {displayCollabStatus(collaboration.status)}
                  </span>
                  <span className="kos-badge text-kos-muted">
                    {
                      COLLAB_PRIORITY_LABELS[
                        collaboration.priority as keyof typeof COLLAB_PRIORITY_LABELS
                      ]
                    }{" "}
                    priority
                  </span>
                </div>
                <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-4xl">
                  {collaboration.projectName}
                </h1>
                <p className="mt-2 text-sm text-kos-muted">
                  {collaboration.partner.chain ?? "Multi-chain"} ·{" "}
                  {collaboration.partner.category ?? "Collaboration partner"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {collaboration.tags.map(({ tag }) => (
                    <span
                      key={tag.id}
                      className="rounded-full border border-white/[0.09] px-2.5 py-1 text-xs text-kos-muted"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <select
                  className="kos-input h-10 w-auto min-w-44 py-1"
                  value={collaboration.status}
                  onChange={(event) =>
                    void patch(
                      { status: event.target.value },
                      `Moved to ${displayCollabStatus(event.target.value)}.`,
                    )
                  }
                >
                  {COLLAB_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {COLLAB_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              ) : null}
              {canCreateRaffle ? (
                <button
                  className="kos-btn-primary h-10"
                  onClick={() => setShowRaffle(true)}
                >
                  <IconTicket /> Create raffle
                </button>
              ) : null}
              {canArchive ? (
                <button className="kos-btn h-10 text-red-300" onClick={archive}>
                  Archive
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-white/[0.08] bg-white/[0.08] sm:grid-cols-3 lg:grid-cols-6">
          <HeaderMetric
            label="WL allocation"
            value={collaboration.whitelistAllocation}
          />
          <HeaderMetric
            label="Wallets collected"
            value={`${data.walletProgress.collected}/${data.walletProgress.total}`}
          />
          <HeaderMetric
            label="Submitted"
            value={data.walletProgress.submitted}
          />
          <HeaderMetric
            label="Attached raffles"
            value={collaboration.raffles.length}
          />
          <HeaderMetric
            label="Owner"
            value={
              people.get(collaboration.ownerId ?? "")?.name ?? "Unassigned"
            }
            small
          />
          <HeaderMetric
            label="Next deadline"
            value={shortDate(
              collaboration.walletSubmissionDeadline ??
                collaboration.collaborationDeadline ??
                collaboration.hostAt,
            )}
            small
          />
        </div>
      </div>

      {message ? (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-blue-400/20 bg-blue-400/10 px-4 py-3 text-sm text-blue-100">
          <span>{message}</span>
          <button
            onClick={() => setMessage(null)}
            className="text-blue-200/70 hover:text-white"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto border-b border-white/[0.08]">
        <div className="flex min-w-max gap-1 pb-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-xl px-3 py-2 text-sm transition-colors ${tab === item.id ? "bg-white text-black" : "text-kos-muted hover:bg-white/[0.05] hover:text-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {tab === "overview" ? (
          <OverviewTab
            data={data}
            canEdit={canEdit}
            canAssign={canAssign}
            onSave={patch}
          />
        ) : null}
        {tab === "timeline" ? (
          <ActivityTimeline
            items={collaboration.activities.filter(
              (item) =>
                item.action.includes("STATUS") ||
                item.action.includes("RAFFLE") ||
                item.action.includes("WALLET") ||
                item.action.includes("CREATED"),
            )}
            people={people}
          />
        ) : null}
        {tab === "requirements" ? (
          <RequirementsTab
            value={collaboration.requirements ?? ""}
            canEdit={canEdit}
            onSave={(requirements) =>
              patch({ requirements }, "Requirements saved.")
            }
          />
        ) : null}
        {tab === "wallets" ? (
          <WalletsTab
            data={data}
            org={org}
            canEdit={canEdit}
            canExport={canExport}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
        {tab === "raffles" ? (
          <RafflesTab
            data={data}
            org={org}
            canEdit={canEdit}
            canExport={canExport}
            canCreate={canCreateRaffle}
            onCreate={() => setShowRaffle(true)}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
        {tab === "contacts" ? (
          <ContactsTab
            data={data}
            org={org}
            canEdit={canEdit}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
        {tab === "notes" ? (
          <NotesTab
            data={data}
            org={org}
            canEdit={canEdit}
            people={people}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
        {tab === "files" ? (
          <FilesTab
            data={data}
            org={org}
            canEdit={canEdit}
            people={people}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
        {tab === "activity" ? (
          <ActivityTimeline items={collaboration.activities} people={people} />
        ) : null}
        {tab === "comments" ? (
          <CommentsTab
            data={data}
            org={org}
            canEdit={canEdit}
            people={people}
            mutate={mutate}
            setMessage={setMessage}
          />
        ) : null}
      </div>
    </>
  );
}

function OverviewTab({
  data,
  canEdit,
  canAssign,
  onSave,
}: {
  data: DetailData;
  canEdit: boolean;
  canAssign: boolean;
  onSave: (body: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const c = data.collaboration;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => overviewForm(c));
  useEffect(() => setForm(overviewForm(c)), [c]);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    const ok = await onSave(
      {
        ...form,
        whitelistAllocation: Number(form.whitelistAllocation || 0),
        trustRating: form.trustRating ? Number(form.trustRating) : null,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...Object.fromEntries(
          [
            "hostAt",
            "hostingDeadline",
            "walletSubmissionDeadline",
            "collaborationDeadline",
            "followUpAt",
          ].map((key) => [
            key,
            form[key as keyof typeof form]
              ? new Date(form[key as keyof typeof form]).toISOString()
              : null,
          ]),
        ),
      },
      "Collaboration details saved.",
    );
    if (ok) setEditing(false);
  }
  if (editing && canEdit) {
    return (
      <div className="kos-card p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <SectionTitle>Edit overview</SectionTitle>
          <button className="kos-btn h-9" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Project name"
            value={form.projectName}
            onChange={(value) => set("projectName", value)}
          />
          <Input
            label="Project logo URL"
            value={form.logoUrl}
            onChange={(value) => set("logoUrl", value)}
          />
          <Input
            label="Website"
            value={form.websiteUrl}
            onChange={(value) => set("websiteUrl", value)}
          />
          <Input
            label="Discord invite"
            value={form.discordUrl}
            onChange={(value) => set("discordUrl", value)}
          />
          <Input
            label="X profile"
            value={form.xUrl}
            onChange={(value) => set("xUrl", value)}
          />
          <Input
            label="Chain"
            value={form.chain}
            onChange={(value) => set("chain", value)}
          />
          <Input
            label="Category"
            value={form.category}
            onChange={(value) => set("category", value)}
          />
          <Input
            label="Whitelist allocation"
            type="number"
            value={form.whitelistAllocation}
            onChange={(value) => set("whitelistAllocation", value)}
          />
          <div>
            <label className="kos-label">Priority</label>
            <select
              className="kos-input"
              value={form.priority}
              onChange={(event) => set("priority", event.target.value)}
            >
              {COLLAB_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {COLLAB_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Tags"
            value={form.tags}
            onChange={(value) => set("tags", value)}
            placeholder="VIP, Gaming, Partner"
          />
          <Input
            label="Hosting date"
            type="datetime-local"
            value={form.hostAt}
            onChange={(value) => set("hostAt", value)}
          />
          <Input
            label="Hosting deadline"
            type="datetime-local"
            value={form.hostingDeadline}
            onChange={(value) => set("hostingDeadline", value)}
          />
          <Input
            label="Wallet submission deadline"
            type="datetime-local"
            value={form.walletSubmissionDeadline}
            onChange={(value) => set("walletSubmissionDeadline", value)}
          />
          <Input
            label="Collaboration deadline"
            type="datetime-local"
            value={form.collaborationDeadline}
            onChange={(value) => set("collaborationDeadline", value)}
          />
          <Input
            label="Follow-up reminder"
            type="datetime-local"
            value={form.followUpAt}
            onChange={(value) => set("followUpAt", value)}
          />
          <Input
            label="Inactive reminder after (days)"
            type="number"
            value={form.noResponseDays}
            onChange={(value) => set("noResponseDays", value)}
          />
          {canAssign ? (
            <>
              <TeamSelect
                label="Owner"
                value={form.ownerId}
                team={data.team}
                onChange={(value) => set("ownerId", value)}
              />
              <TeamSelect
                label="Assigned teammate"
                value={form.assignedToId}
                team={data.team}
                allowEmpty
                onChange={(value) => set("assignedToId", value)}
              />
              <TeamSelect
                label="Reviewer"
                value={form.reviewerId}
                team={data.team}
                allowEmpty
                onChange={(value) => set("reviewerId", value)}
              />
            </>
          ) : null}
          <div>
            <label className="kos-label">Internal trust rating</label>
            <input
              className="kos-input"
              type="range"
              min="1"
              max="5"
              value={form.trustRating || "3"}
              onChange={(event) => set("trustRating", event.target.value)}
            />
            <div className="mt-1 text-xs text-kos-muted">
              {form.trustRating || "Not rated"} / 5
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="kos-label">Partner private notes</label>
            <textarea
              className="kos-input min-h-28"
              value={form.privateNotes}
              onChange={(event) => set("privateNotes", event.target.value)}
            />
          </div>
        </div>
        <button className="kos-btn-primary mt-5" onClick={save}>
          <IconCheck /> Save changes
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="kos-card p-5 lg:col-span-2">
        <SectionTitle
          action={
            canEdit ? (
              <button
                className="kos-btn h-8 px-3 text-xs"
                onClick={() => setEditing(true)}
              >
                Edit overview
              </button>
            ) : undefined
          }
        >
          Collaboration brief
        </SectionTitle>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Detail label="Project" value={c.projectName} />
          <Detail
            label="Chain / Category"
            value={
              [c.partner.chain, c.partner.category]
                .filter(Boolean)
                .join(" · ") || "Not set"
            }
          />
          <Detail
            label="Owner"
            value={
              data.team.find((person) => person.id === c.ownerId)?.name ??
              "Unassigned"
            }
          />
          <Detail
            label="Assigned teammate"
            value={
              data.team.find((person) => person.id === c.assignedToId)?.name ??
              "Unassigned"
            }
          />
          <Detail
            label="Reviewer"
            value={
              data.team.find((person) => person.id === c.reviewerId)?.name ??
              "Not set"
            }
          />
          <Detail
            label="Submission status"
            value={c.submissionStatus.replaceAll("_", " ")}
          />
          <Detail label="Hosting date" value={fullDate(c.hostAt)} />
          <Detail
            label="Wallet deadline"
            value={fullDate(c.walletSubmissionDeadline)}
          />
          <Detail
            label="Collaboration deadline"
            value={fullDate(c.collaborationDeadline)}
          />
          <Detail label="Follow up" value={fullDate(c.followUpAt)} />
        </div>
      </div>
      <div className="space-y-4">
        <div className="kos-card p-5">
          <SectionTitle>Partner links</SectionTitle>
          <div className="space-y-2">
            {[
              ["Website", c.partner.websiteUrl],
              ["Discord", c.partner.discordUrl],
              ["X profile", c.partner.xUrl],
            ].map(([label, url]) =>
              url ? (
                <a
                  key={label}
                  className="kos-btn w-full justify-between"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{label}</span>
                  <span>↗</span>
                </a>
              ) : null,
            )}
            {!c.partner.websiteUrl &&
            !c.partner.discordUrl &&
            !c.partner.xUrl ? (
              <p className="text-sm text-kos-muted">No public links added.</p>
            ) : null}
          </div>
        </div>
        <div className="kos-card p-5">
          <SectionTitle>Open reminders</SectionTitle>
          <div className="space-y-2">
            {c.reminders
              .filter((item) => !item.completedAt)
              .slice(0, 5)
              .map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/[0.07] p-3"
                >
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-kos-muted">
                    {fullDate(item.dueAt)}
                  </div>
                </div>
              ))}
            {c.reminders.filter((item) => !item.completedAt).length === 0 ? (
              <p className="text-sm text-kos-muted">No open reminders.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function RequirementsTab({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="kos-card p-5 sm:p-6">
      <SectionTitle>Requirements & deliverables</SectionTitle>
      {canEdit ? (
        <>
          <textarea
            className="kos-input min-h-72 resize-y text-sm leading-6"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Document every role requirement, social action, wallet rule, deliverable, and partner constraint here."
          />
          <button className="kos-btn-primary mt-4" onClick={() => onSave(text)}>
            <IconCheck /> Save requirements
          </button>
        </>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-7 text-kos-muted">
          {text || "No requirements documented."}
        </div>
      )}
    </div>
  );
}

function WalletsTab({
  data,
  org,
  canEdit,
  canExport,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  canExport: boolean;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const c = data.collaboration;
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importChain, setImportChain] = useState("ETHEREUM");
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<
    { row: number; error: string }[]
  >([]);
  async function exportWallets(format: string) {
    const res = await fetch(
      `/api/${org}/collaborations/${c.id}/wallets/export?format=${format}`,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setMessage(body.error ?? "Export failed.");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename="([^"]+)"/)?.[1] ?? `wallets.${format}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Wallets exported and marked submitted.");
    await mutate();
  }
  async function setStatus(walletId: string, status: string) {
    await fetch(`/api/${org}/collaborations/${c.id}/wallets/${walletId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    mutate();
  }
  async function importWallets() {
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportErrors([]);
    const res = await fetch(
      `/api/${org}/collaborations/${c.id}/wallets/import`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: importText,
          defaultChain: importChain,
        }),
      },
    );
    const body = await res.json().catch(() => ({}));
    setImportBusy(false);
    setImportErrors(Array.isArray(body.errors) ? body.errors : []);
    if (!res.ok) {
      setMessage(body.error ?? "Wallet import failed.");
      return;
    }
    setMessage(
      `${body.imported} registered wallet${body.imported === 1 ? "" : "s"} imported${body.errors?.length ? `; ${body.errors.length} row${body.errors.length === 1 ? "" : "s"} skipped` : ""}.`,
    );
    setImportText("");
    await mutate();
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Allocated" value={c.whitelistAllocation} />
        <Mini label="Collected" value={data.walletProgress.collected} />
        <Mini label="Submitted" value={data.walletProgress.submitted} />
        <Mini label="Remaining" value={data.walletProgress.remaining} />
        <Mini label="Rejected" value={data.walletProgress.rejected} />
      </div>
      <div className="kos-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionTitle>Collection progress</SectionTitle>
            <div className="text-3xl font-semibold">
              {data.walletProgress.percent}%
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <button
                className="kos-btn"
                onClick={() => setImportOpen((value) => !value)}
              >
                <IconPlus /> Import list
              </button>
            ) : null}
            {canExport ? (
              <>
                <button
                  className="kos-btn"
                  onClick={() => exportWallets("csv")}
                >
                  CSV
                </button>
                <button
                  className="kos-btn"
                  onClick={() => exportWallets("xlsx")}
                >
                  Excel
                </button>
                <button
                  className="kos-btn-primary"
                  onClick={() => exportWallets("txt")}
                >
                  TXT addresses
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-400"
            style={{ width: `${data.walletProgress.percent}%` }}
          />
        </div>
      </div>
      {canEdit && importOpen ? (
        <div className="kos-card p-5 sm:p-6">
          <SectionTitle>Import registered wallet list</SectionTitle>
          <p className="mb-4 max-w-3xl text-sm leading-6 text-kos-muted">
            Paste CSV/TXT rows as <code>discord_id,wallet_address</code>, or
            include a <code>chain</code> column. For member safety, an imported
            address must already match that user's encrypted KOS wallet; this
            tool never overwrites their profile.
          </p>
          <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
            <label className="text-xs font-medium text-kos-muted">
              Default chain
              <select
                className="kos-input mt-2"
                value={importChain}
                onChange={(event) => setImportChain(event.target.value)}
              >
                {WALLET_CHAINS.map((chain) => (
                  <option key={chain} value={chain}>
                    {chain}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-kos-muted">
              Wallet rows
              <textarea
                className="kos-input mt-2 min-h-36 resize-y font-mono text-xs leading-6"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={
                  "discord_id,chain,wallet_address\n123456789,ETHEREUM,0x…"
                }
              />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="kos-btn w-fit cursor-pointer">
              Choose CSV/TXT
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) setImportText(await file.text());
                }}
              />
            </label>
            <button
              className="kos-btn-primary"
              disabled={importBusy || !importText.trim()}
              onClick={importWallets}
            >
              {importBusy ? "Validating…" : "Validate and import"}
            </button>
          </div>
          {importErrors.length ? (
            <div className="mt-4 max-h-44 overflow-auto rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-100">
              {importErrors.slice(0, 25).map((item, index) => (
                <div key={`${item.row}-${index}`} className="py-1">
                  Row {item.row}: {item.error}
                </div>
              ))}
              {importErrors.length > 25 ? (
                <div className="pt-2 text-amber-200/70">
                  + {importErrors.length - 25} more validation errors
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {c.wallets.length ? (
        <div className="kos-card overflow-hidden">
          <div className="divide-y divide-white/[0.07]">
            {c.wallets.map((wallet) => (
              <div
                key={wallet.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              >
                <Avatar
                  person={{
                    id: wallet.userId,
                    name: wallet.user.globalName ?? wallet.user.username,
                    avatarUrl: wallet.user.avatarUrl,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {wallet.user.globalName ?? wallet.user.username}
                  </div>
                  <div className="text-xs text-kos-muted">
                    {wallet.userId} · {wallet.chain ?? "No wallet yet"}
                  </div>
                </div>
                <span
                  className={`kos-badge ${wallet.status === "SUBMITTED" ? "border-emerald-400/25 text-emerald-300" : wallet.status === "REJECTED" ? "border-red-400/25 text-red-300" : wallet.status === "COLLECTED" ? "border-blue-400/25 text-blue-300" : "text-kos-muted"}`}
                >
                  {wallet.status.toLowerCase()}
                </span>
                {canEdit ? (
                  <select
                    className="kos-input h-9 w-auto py-1 text-xs"
                    value={wallet.status}
                    onChange={(event) =>
                      setStatus(wallet.id, event.target.value)
                    }
                  >
                    <option value="WAITING">Waiting</option>
                    <option value="COLLECTED">Collected</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Empty>
          Winner wallets appear automatically after an attached raffle ends.
        </Empty>
      )}
    </div>
  );
}

function RafflesTab({
  data,
  org,
  canEdit,
  canExport,
  canCreate,
  onCreate,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  canExport: boolean;
  canCreate: boolean;
  onCreate: () => void;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [raffleId, setRaffleId] = useState("");
  async function attach() {
    if (!raffleId) return;
    const res = await fetch(
      `/api/${org}/collaborations/${data.collaboration.id}/raffles`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raffleId: Number(raffleId) }),
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage(body.error ?? "Couldn't attach raffle.");
    setRaffleId("");
    setMessage("Raffle attached.");
    await mutate();
  }
  async function detach(id: number) {
    await fetch(`/api/${org}/collaborations/${data.collaboration.id}/raffles`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raffleId: id }),
    });
    mutate();
  }
  return (
    <div className="space-y-4">
      <div className="kos-card p-5">
        <SectionTitle
          action={
            canCreate ? (
              <button className="kos-btn-primary h-9" onClick={onCreate}>
                <IconPlus /> Create from collaboration
              </button>
            ) : undefined
          }
        >
          Attach raffle
        </SectionTitle>
        {canEdit ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="kos-input"
              value={raffleId}
              onChange={(event) => setRaffleId(event.target.value)}
            >
              <option value="">Choose an existing raffle…</option>
              {data.availableRaffles.map((raffle) => (
                <option key={raffle.id} value={raffle.id}>
                  #{raffle.id} · {raffle.projectName} · {raffle.status}
                </option>
              ))}
            </select>
            <button className="kos-btn" disabled={!raffleId} onClick={attach}>
              Attach
            </button>
          </div>
        ) : null}
      </div>
      {data.collaboration.raffles.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.collaboration.raffles.map(({ raffle }) => (
            <div key={raffle.id} className="kos-card overflow-hidden">
              <div className="flex gap-4 p-4">
                {raffle.bannerUrl ? (
                  <img
                    src={raffle.bannerUrl}
                    alt=""
                    className="h-20 w-28 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-28 items-center justify-center rounded-xl bg-white/[0.04]">
                    <IconTicket />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      #{raffle.id} · {raffle.projectName}
                    </span>
                    <span className="kos-badge text-kos-muted">
                      {raffle.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-kos-muted">
                    {raffle.title}
                  </p>
                  <p className="mt-2 text-xs text-kos-muted">
                    {raffle.entryCount} entries · {raffle._count.winners}{" "}
                    winners
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-white/[0.07] p-3">
                <Link
                  className="kos-btn h-9 text-xs"
                  href={`/${org}/raffles/${raffle.id}`}
                >
                  Open raffle
                </Link>
                <Link className="kos-btn h-9 text-xs" href={`/r/${raffle.id}`}>
                  Public page
                </Link>
                {raffle.proof?.messageLink ? (
                  <a
                    className="kos-btn h-9 text-xs"
                    href={raffle.proof.messageLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Proof report ↗
                  </a>
                ) : null}
                {raffle.proof?.artifactsStoredAt ? (
                  <>
                    <a
                      className="kos-btn h-9 text-xs"
                      href={`/api/${org}/collaborations/${data.collaboration.id}/artifacts/${raffle.id}/pdf`}
                    >
                      PDF
                    </a>
                    <a
                      className="kos-btn h-9 text-xs"
                      href={`/api/${org}/collaborations/${data.collaboration.id}/artifacts/${raffle.id}/card`}
                    >
                      Winner card
                    </a>
                    {canExport ? (
                      <a
                        className="kos-btn h-9 text-xs"
                        href={`/api/${org}/collaborations/${data.collaboration.id}/artifacts/${raffle.id}/csv`}
                      >
                        Winners CSV
                      </a>
                    ) : null}
                  </>
                ) : null}
                {canEdit ? (
                  <button
                    className="ml-auto text-xs text-red-300"
                    onClick={() => detach(raffle.id)}
                  >
                    Detach
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty>
          No raffles attached. Create one here or attach an existing raffle to
          start automated wallet tracking.
        </Empty>
      )}
    </div>
  );
}

function ContactsTab({
  data,
  org,
  canEdit,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    role: "",
    discord: "",
    telegram: "",
    xUrl: "",
    email: "",
    notes: "",
    conversation: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  function reset() {
    setEditingId(null);
    setForm({
      name: "",
      role: "",
      discord: "",
      telegram: "",
      xUrl: "",
      email: "",
      notes: "",
      conversation: "",
    });
  }
  async function add() {
    const res = await itemRequest(
      org,
      data.collaboration.id,
      editingId ? "PATCH" : "POST",
      {
        kind: "contact",
        ...(editingId ? { itemId: editingId } : {}),
        ...form,
      },
    );
    if (!res.ok) return setMessage(res.error);
    setMessage(editingId ? "Contact updated." : "Contact added.");
    reset();
    mutate();
  }
  function edit(contact: DetailData["collaboration"]["contacts"][number]) {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      role: contact.role ?? "",
      discord: contact.discord ?? "",
      telegram: contact.telegram ?? "",
      xUrl: contact.xUrl ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
      conversation: contact.conversation ?? "",
    });
  }
  async function remove(itemId: string) {
    await itemRequest(org, data.collaboration.id, "DELETE", {
      kind: "contact",
      itemId,
    });
    mutate();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {data.collaboration.contacts.map((contact) => (
          <div key={contact.id} className="kos-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{contact.name}</h3>
                  {contact.isPrimary ? (
                    <span className="kos-badge border-blue-400/25 text-blue-300">
                      Primary
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-kos-muted">
                  {contact.role ?? "Contact"}
                </p>
              </div>
              {canEdit ? (
                <div className="flex gap-3">
                  <button
                    className="text-xs text-blue-300"
                    onClick={() => edit(contact)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-xs text-red-300"
                    onClick={() => remove(contact.id)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {contact.discord ? (
                <Detail label="Discord" value={contact.discord} />
              ) : null}
              {contact.telegram ? (
                <Detail label="Telegram" value={contact.telegram} />
              ) : null}
              {contact.email ? (
                <Detail label="Email" value={contact.email} />
              ) : null}
              {contact.xUrl ? (
                <a
                  className="text-blue-300"
                  href={contact.xUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  X profile ↗
                </a>
              ) : null}
            </div>
            {contact.notes ? (
              <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/[0.03] p-3 text-sm text-kos-muted">
                {contact.notes}
              </p>
            ) : null}
            {contact.conversation ? (
              <div className="mt-3">
                <div className="kos-label">Conversation history</div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-kos-muted">
                  {contact.conversation}
                </p>
              </div>
            ) : null}
          </div>
        ))}
        {!data.collaboration.contacts.length ? (
          <Empty>No contacts yet.</Empty>
        ) : null}
      </div>
      {canEdit ? (
        <div className="kos-card h-fit p-5">
          <SectionTitle
            action={
              editingId ? (
                <button className="text-xs text-kos-muted" onClick={reset}>
                  Cancel
                </button>
              ) : undefined
            }
          >
            {editingId ? "Edit contact" : "Add contact"}
          </SectionTitle>
          <div className="space-y-3">
            <Input
              label="Name"
              value={form.name}
              onChange={(value) => set("name", value)}
            />
            <Input
              label="Role"
              value={form.role}
              onChange={(value) => set("role", value)}
            />
            <Input
              label="Discord"
              value={form.discord}
              onChange={(value) => set("discord", value)}
            />
            <Input
              label="Telegram"
              value={form.telegram}
              onChange={(value) => set("telegram", value)}
            />
            <Input
              label="X profile"
              value={form.xUrl}
              onChange={(value) => set("xUrl", value)}
            />
            <Input
              label="Email"
              value={form.email}
              onChange={(value) => set("email", value)}
            />
            <textarea
              className="kos-input min-h-20"
              placeholder="Private notes"
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
            <textarea
              className="kos-input min-h-24"
              placeholder="Conversation history"
              value={form.conversation}
              onChange={(event) => set("conversation", event.target.value)}
            />
            <button
              className="kos-btn-primary w-full"
              disabled={!form.name.trim()}
              onClick={add}
            >
              {editingId ? <IconCheck /> : <IconPlus />}{" "}
              {editingId ? "Save contact" : "Add contact"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotesTab({
  data,
  org,
  canEdit,
  people,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  people: Map<string, Person>;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  async function add() {
    const res = await itemRequest(
      org,
      data.collaboration.id,
      editingId ? "PATCH" : "POST",
      {
        kind: "note",
        ...(editingId ? { itemId: editingId } : {}),
        body,
        pinned,
      },
    );
    if (!res.ok) return setMessage(res.error);
    setBody("");
    setPinned(false);
    setEditingId(null);
    mutate();
  }
  async function update(itemId: string, patch: Record<string, unknown>) {
    await itemRequest(org, data.collaboration.id, "PATCH", {
      kind: "note",
      itemId,
      ...patch,
    });
    mutate();
  }
  async function remove(itemId: string) {
    await itemRequest(org, data.collaboration.id, "DELETE", {
      kind: "note",
      itemId,
    });
    mutate();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {canEdit ? (
        <div className="kos-card h-fit p-5">
          <SectionTitle
            action={
              editingId ? (
                <button
                  className="text-xs text-kos-muted"
                  onClick={() => {
                    setEditingId(null);
                    setBody("");
                    setPinned(false);
                  }}
                >
                  Cancel
                </button>
              ) : undefined
            }
          >
            {editingId ? "Edit internal note" : "New internal note"}
          </SectionTitle>
          <RichTextEditor
            key={editingId ?? "new-note"}
            value={body}
            onChange={setBody}
          />
          <label className="mt-3 flex items-center gap-2 text-sm text-kos-muted">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
            />{" "}
            Pin this note
          </label>
          <button
            className="kos-btn-primary mt-3 w-full"
            disabled={richTextIsEmpty(body)}
            onClick={add}
          >
            {editingId ? "Update note" : "Save note"}
          </button>
        </div>
      ) : null}
      <div
        className={`space-y-3 ${canEdit ? "lg:col-span-2" : "lg:col-span-3"}`}
      >
        {data.collaboration.notes.map((note) => (
          <div
            key={note.id}
            className={`kos-card p-5 ${note.pinned ? "border-amber-400/20 bg-amber-400/[0.035]" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Avatar person={people.get(note.authorId)} />
                <div>
                  <div className="text-sm font-medium">
                    {people.get(note.authorId)?.name ?? "Team member"}
                  </div>
                  <div className="text-[11px] text-kos-muted">
                    {relative(note.updatedAt)}
                  </div>
                </div>
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <button
                    className="text-xs text-blue-300"
                    onClick={() => {
                      setEditingId(note.id);
                      setBody(note.body);
                      setPinned(note.pinned);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-xs text-kos-muted hover:text-amber-300"
                    onClick={() => update(note.id, { pinned: !note.pinned })}
                  >
                    {note.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="text-xs text-red-300"
                    onClick={() => remove(note.id)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
            <RichText value={note.body} />
          </div>
        ))}
        {!data.collaboration.notes.length ? (
          <Empty>No internal notes yet.</Empty>
        ) : null}
      </div>
    </div>
  );
}

function FilesTab({
  data,
  org,
  canEdit,
  people,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  people: Map<string, Person>;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setMessage("Files must be 15 MB or smaller.");
      return;
    }
    setBusy(true);
    setProgress(0);
    const safeName =
      file.name.replace(/[^a-z0-9._-]+/gi, "-").slice(-100) || "file";
    try {
      const blob = await uploadBlob(
        `orgs/${org}/collaborations/${data.collaboration.id}/${Date.now()}-${safeName}`,
        file,
        {
          access: "private",
          handleUploadUrl: `/api/${org}/collaborations/${data.collaboration.id}/attachments`,
          contentType: file.type,
          multipart: file.size > 5 * 1024 * 1024,
          onUploadProgress: ({ percentage }) =>
            setProgress(Math.round(percentage)),
        },
      );
      const res = await fetch(
        `/api/${org}/collaborations/${data.collaboration.id}/attachments`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: blob.url, name: file.name }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      setMessage("File attached securely.");
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }
  async function remove(attachmentId: string) {
    await fetch(
      `/api/${org}/collaborations/${data.collaboration.id}/attachments`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attachmentId }),
      },
    );
    mutate();
  }
  return (
    <div className="space-y-4">
      {canEdit ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.14] bg-white/[0.025] px-6 py-10 text-center transition-colors hover:bg-white/[0.045]">
          <IconDoc className="h-8 w-8 text-blue-300" />
          <span className="mt-3 font-medium">
            {busy ? `Uploading… ${progress}%` : "Drop or choose a file"}
          </span>
          <span className="mt-1 text-xs text-kos-muted">
            Images, PDF, CSV, Excel, Word, screenshots and wallet lists · 15 MB
            max
          </span>
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </label>
      ) : null}
      {data.collaboration.attachments.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.collaboration.attachments.map((file) => (
            <div key={file.id} className="kos-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
                  <IconDoc />
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/${org}/collaborations/${data.collaboration.id}/attachments?attachmentId=${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium hover:text-blue-300"
                  >
                    {file.name}
                  </a>
                  <div className="mt-1 text-[11px] text-kos-muted">
                    {formatBytes(file.size)} · {relative(file.createdAt)}
                  </div>
                  <div className="text-[11px] text-kos-muted">
                    by {people.get(file.uploadedById)?.name ?? "Team member"}
                  </div>
                </div>
                {canEdit ? (
                  <button
                    className="text-xs text-red-300"
                    onClick={() => remove(file.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No files attached.</Empty>
      )}
    </div>
  );
}

function CommentsTab({
  data,
  org,
  canEdit,
  people,
  mutate,
  setMessage,
}: {
  data: DetailData;
  org: string;
  canEdit: boolean;
  people: Map<string, Person>;
  mutate: () => Promise<unknown>;
  setMessage: (message: string) => void;
}) {
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  async function add() {
    const res = await itemRequest(
      org,
      data.collaboration.id,
      editingId ? "PATCH" : "POST",
      {
        kind: "comment",
        ...(editingId ? { itemId: editingId } : {}),
        body,
      },
    );
    if (!res.ok) return setMessage(res.error);
    setBody("");
    setEditingId(null);
    mutate();
  }
  async function remove(itemId: string) {
    await itemRequest(org, data.collaboration.id, "DELETE", {
      kind: "comment",
      itemId,
    });
    mutate();
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {canEdit ? (
        <div className="kos-card p-4">
          <textarea
            className="kos-input min-h-24"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Share an update. Mention a teammate with @DiscordID."
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-kos-muted">
              {editingId
                ? "Editing an existing team comment."
                : "Mentions create an in-app notification."}
            </span>
            <div className="flex gap-2">
              {editingId ? (
                <button
                  className="kos-btn"
                  onClick={() => {
                    setEditingId(null);
                    setBody("");
                  }}
                >
                  Cancel
                </button>
              ) : null}
              <button
                className="kos-btn-primary"
                disabled={!body.trim()}
                onClick={add}
              >
                {editingId ? "Update comment" : "Comment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="space-y-3">
        {data.collaboration.comments.map((comment) => (
          <div key={comment.id} className="kos-card p-4">
            <div className="flex items-start gap-3">
              <Avatar person={people.get(comment.authorId)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">
                      {people.get(comment.authorId)?.name ?? "Team member"}
                    </span>
                    <span className="ml-2 text-[11px] text-kos-muted">
                      {relative(comment.createdAt)}
                    </span>
                  </div>
                  {canEdit ? (
                    <div className="flex gap-3">
                      <button
                        className="text-xs text-blue-300"
                        onClick={() => {
                          setEditingId(comment.id);
                          setBody(comment.body);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="text-xs text-red-300"
                        onClick={() => remove(comment.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {comment.body}
                </p>
              </div>
            </div>
          </div>
        ))}
        {!data.collaboration.comments.length ? (
          <Empty>No comments yet.</Empty>
        ) : null}
      </div>
    </div>
  );
}

function ActivityTimeline({
  items,
  people,
}: {
  items: DetailData["collaboration"]["activities"];
  people: Map<string, Person>;
}) {
  if (!items.length) return <Empty>No activity yet.</Empty>;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative space-y-1 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-px before:bg-white/[0.10]">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative flex gap-4 rounded-2xl p-3 hover:bg-white/[0.025]"
          >
            <div className="z-10 mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-[#111] text-blue-300">
              <IconCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div className="text-sm font-medium">{item.title}</div>
              {item.body ? (
                <p className="mt-1 text-sm leading-6 text-kos-muted">
                  {item.body}
                </p>
              ) : null}
              <div className="mt-1 text-[11px] text-kos-muted">
                {item.actorId
                  ? (people.get(item.actorId)?.name ?? "Team member")
                  : "KOS automation"}{" "}
                · {fullDate(item.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeaderMetric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="min-w-0 bg-[#111] px-4 py-4">
      <div
        className={`${small ? "truncate text-sm" : "text-xl"} font-semibold`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kos-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-kos-muted">
        {label}
      </div>
      <div className="mt-1 text-sm capitalize">{value}</div>
    </div>
  );
}
function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="kos-label">{label}</label>
      <input
        className="kos-input"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
function TeamSelect({
  label,
  value,
  team,
  onChange,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  team: Person[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <label className="kos-label">{label}</label>
      <select
        className="kos-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {allowEmpty ? <option value="">Unassigned</option> : null}
        {team.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name} · {person.role}
          </option>
        ))}
      </select>
    </div>
  );
}
function Avatar({ person }: { person?: Person }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.05] text-[10px] font-bold">
      {person?.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        (person?.name ?? "T").slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) {
      editor.current.innerHTML = value;
    }
  }, [value]);
  function command(name: string, commandValue?: string) {
    editor.current?.focus();
    document.execCommand(name, false, commandValue);
    onChange(editor.current?.innerHTML ?? "");
  }
  const tools = [
    ["Bold", "bold", undefined, "B"],
    ["Italic", "italic", undefined, "I"],
    ["Underline", "underline", undefined, "U"],
    ["Heading", "formatBlock", "h3", "H"],
    ["Bullet list", "insertUnorderedList", undefined, "• List"],
    ["Numbered list", "insertOrderedList", undefined, "1. List"],
    ["Quote", "formatBlock", "blockquote", "❝"],
    ["Clear formatting", "removeFormat", undefined, "Clear"],
  ] as const;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.10] bg-black/20 focus-within:border-blue-400/45">
      <div
        className="flex flex-wrap gap-1 border-b border-white/[0.08] bg-white/[0.025] p-2"
        role="toolbar"
        aria-label="Note formatting"
      >
        {tools.map(([label, name, commandValue, display]) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            className="h-8 rounded-lg px-2 text-xs text-kos-muted transition-colors hover:bg-white/[0.08] hover:text-white"
            onMouseDown={(event) => {
              event.preventDefault();
              command(name, commandValue);
            }}
          >
            {display}
          </button>
        ))}
      </div>
      <div
        ref={editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Write context, updates, or negotiation notes…"
        className="min-h-48 px-4 py-3 text-sm leading-7 outline-none empty:before:pointer-events-none empty:before:text-kos-muted empty:before:content-[attr(data-placeholder)] [&_blockquote]:border-l-2 [&_blockquote]:border-blue-400/40 [&_blockquote]:pl-3 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc"
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}

function RichText({ value }: { value: string }) {
  return (
    <div
      className="mt-4 whitespace-pre-wrap text-sm leading-7 [&_a]:text-blue-300 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-400/40 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/[0.07] [&_code]:px-1 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-black/40 [&_pre]:p-3 [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}

function richTextIsEmpty(value: string): boolean {
  return !value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|\s/gi, "")
    .trim();
}

function overviewForm(c: DetailData["collaboration"]) {
  return {
    projectName: c.projectName,
    logoUrl: c.partner.logoUrl ?? "",
    websiteUrl: c.partner.websiteUrl ?? "",
    discordUrl: c.partner.discordUrl ?? "",
    xUrl: c.partner.xUrl ?? "",
    chain: c.partner.chain ?? "",
    category: c.partner.category ?? "",
    whitelistAllocation: String(c.whitelistAllocation),
    priority: c.priority,
    tags: c.tags.map(({ tag }) => tag.name).join(", "),
    hostAt: dateInput(c.hostAt),
    hostingDeadline: dateInput(c.hostingDeadline),
    walletSubmissionDeadline: dateInput(c.walletSubmissionDeadline),
    collaborationDeadline: dateInput(c.collaborationDeadline),
    followUpAt: dateInput(c.followUpAt),
    noResponseDays: String(c.noResponseDays),
    ownerId: c.ownerId ?? "",
    assignedToId: c.assignedToId ?? "",
    reviewerId: c.reviewerId ?? "",
    privateNotes: c.partner.privateNotes ?? "",
    trustRating: c.partner.trustRating ? String(c.partner.trustRating) : "",
  };
}

async function itemRequest(
  org: string,
  id: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error: string }> {
  const res = await fetch(`/api/${org}/collaborations/${id}/items`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error ?? "Action failed." };
}

function dateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function shortDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : "Not set";
}
function fullDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not set";
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
function formatBytes(value: number | null) {
  if (!value) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-64 animate-pulse rounded-[2rem] bg-white/[0.035]" />
      <div className="h-12 animate-pulse rounded-2xl bg-white/[0.035]" />
      <div className="h-96 animate-pulse rounded-3xl bg-white/[0.035]" />
    </div>
  );
}
