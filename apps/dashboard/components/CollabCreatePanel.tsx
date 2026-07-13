"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useOrg } from "@/lib/org-context";
import {
  COLLAB_PRIORITIES,
  COLLAB_PRIORITY_LABELS,
  COLLAB_STATUSES,
  COLLAB_STATUS_LABELS,
  type CollabPriority,
  type CollabStatus,
} from "@/lib/collab-shared";
import { ImageDrop } from "./ImageDrop";
import { IconCheck, IconClose } from "./icons";

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const STEPS = ["Partner", "Workflow", "Team"] as const;

export function CollabCreatePanel({
  team,
  onClose,
  onCreated,
}: {
  team: TeamMember[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { slug, user } = useOrg();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    projectName: "",
    logoUrl: "",
    websiteUrl: "",
    discordUrl: "",
    xUrl: "",
    chain: "",
    category: "",
    whitelistAllocation: "",
    status: "LEAD" as CollabStatus,
    priority: "MEDIUM" as CollabPriority,
    requirements: "",
    hostAt: "",
    hostingDeadline: "",
    walletSubmissionDeadline: "",
    collaborationDeadline: "",
    followUpAt: "",
    primaryContactName: "",
    contactRole: "Collab manager",
    discordUsername: "",
    telegram: "",
    email: "",
    ownerId: team.some((member) => member.id === user.id)
      ? user.id
      : (team[0]?.id ?? ""),
    assignedToId: "",
    reviewerId: "",
    tags: "",
    notes: "",
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${slug}/collaborations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        whitelistAllocation: Number(form.whitelistAllocation || 0),
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        hostAt: form.hostAt ? new Date(form.hostAt).toISOString() : null,
        hostingDeadline: form.hostingDeadline
          ? new Date(form.hostingDeadline).toISOString()
          : null,
        walletSubmissionDeadline: form.walletSubmissionDeadline
          ? new Date(form.walletSubmissionDeadline).toISOString()
          : null,
        collaborationDeadline: form.collaborationDeadline
          ? new Date(form.collaborationDeadline).toISOString()
          : null,
        followUpAt: form.followUpAt
          ? new Date(form.followUpAt).toISOString()
          : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Couldn't create the collaboration.");
      return;
    }
    onCreated(body.id);
  }

  const canContinue = step > 0 || form.projectName.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-5">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[2rem] border border-white/[0.10] bg-[#101010] shadow-2xl sm:rounded-[2rem]"
        role="dialog"
        aria-modal="true"
        aria-label="Create collaboration"
      >
        <div className="flex items-start justify-between border-b border-white/[0.08] px-5 py-5 sm:px-7">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
              New collaboration
            </div>
            <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
              Add a partner to your pipeline
            </h2>
          </div>
          <button
            className="kos-btn h-10 w-10 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>

        <div className="border-b border-white/[0.08] px-5 py-3 sm:px-7">
          <div className="grid grid-cols-3 gap-2">
            {STEPS.map((label, index) => (
              <button
                key={label}
                onClick={() => index <= step && setStep(index)}
                className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left text-xs transition-colors sm:px-3 ${
                  index === step
                    ? "bg-blue-500/12 text-blue-200"
                    : index < step
                      ? "text-emerald-300"
                      : "text-kos-muted"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]">
                  {index < step ? <IconCheck className="h-3 w-3" /> : index + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-6 sm:px-7">
          {step === 0 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="kos-label">Project name *</label>
                <input
                  autoFocus
                  className="kos-input"
                  placeholder="e.g. Pudgy Penguins"
                  value={form.projectName}
                  onChange={(event) => set("projectName", event.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <ImageDrop
                  label="Project logo"
                  value={form.logoUrl}
                  onChange={(value) => set("logoUrl", value)}
                />
              </div>
              <Field
                label="Website"
                value={form.websiteUrl}
                onChange={(value) => set("websiteUrl", value)}
                placeholder="https://"
              />
              <Field
                label="Discord invite"
                value={form.discordUrl}
                onChange={(value) => set("discordUrl", value)}
                placeholder="https://discord.gg/…"
              />
              <Field
                label="X profile"
                value={form.xUrl}
                onChange={(value) => set("xUrl", value)}
                placeholder="https://x.com/…"
              />
              <Field
                label="Chain"
                value={form.chain}
                onChange={(value) => set("chain", value)}
                placeholder="Ethereum, Solana, Base…"
              />
              <div className="md:col-span-2">
                <Field
                  label="Category"
                  value={form.category}
                  onChange={(value) => set("category", value)}
                  placeholder="Gaming, Art, DeFi, Launchpad…"
                />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Whitelist allocation"
                type="number"
                value={form.whitelistAllocation}
                onChange={(value) => set("whitelistAllocation", value)}
                placeholder="0"
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
              <div>
                <label className="kos-label">Pipeline status</label>
                <select
                  className="kos-input"
                  value={form.status}
                  onChange={(event) => set("status", event.target.value)}
                >
                  {COLLAB_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {COLLAB_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label="Hosting date"
                type="datetime-local"
                value={form.hostAt}
                onChange={(value) => set("hostAt", value)}
              />
              <Field
                label="Hosting deadline"
                type="datetime-local"
                value={form.hostingDeadline}
                onChange={(value) => set("hostingDeadline", value)}
              />
              <Field
                label="Wallet submission deadline"
                type="datetime-local"
                value={form.walletSubmissionDeadline}
                onChange={(value) => set("walletSubmissionDeadline", value)}
              />
              <Field
                label="Collaboration deadline"
                type="datetime-local"
                value={form.collaborationDeadline}
                onChange={(value) => set("collaborationDeadline", value)}
              />
              <Field
                label="Follow-up reminder"
                type="datetime-local"
                value={form.followUpAt}
                onChange={(value) => set("followUpAt", value)}
              />
              <div className="md:col-span-2">
                <label className="kos-label">Requirements</label>
                <textarea
                  className="kos-input min-h-32 resize-y"
                  value={form.requirements}
                  onChange={(event) => set("requirements", event.target.value)}
                  placeholder="Roles, engagement steps, wallet rules, deliverables…"
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Primary contact"
                value={form.primaryContactName}
                onChange={(value) => set("primaryContactName", value)}
                placeholder="Name"
              />
              <Field
                label="Contact role"
                value={form.contactRole}
                onChange={(value) => set("contactRole", value)}
                placeholder="Founder, collab manager…"
              />
              <Field
                label="Discord username"
                value={form.discordUsername}
                onChange={(value) => set("discordUsername", value)}
                placeholder="username"
              />
              <Field
                label="Telegram"
                value={form.telegram}
                onChange={(value) => set("telegram", value)}
                placeholder="@handle"
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => set("email", value)}
                placeholder="team@project.xyz"
              />
              <div>
                <label className="kos-label">Hosting admin</label>
                <select
                  className="kos-input"
                  value={form.ownerId}
                  onChange={(event) => set("ownerId", event.target.value)}
                >
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} · {member.role}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="kos-label">Assigned teammate</label>
                <select
                  className="kos-input"
                  value={form.assignedToId}
                  onChange={(event) => set("assignedToId", event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="kos-label">Reviewer</label>
                <select
                  className="kos-input"
                  value={form.reviewerId}
                  onChange={(event) => set("reviewerId", event.target.value)}
                >
                  <option value="">No reviewer</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Tags"
                  value={form.tags}
                  onChange={(value) => set("tags", value)}
                  placeholder="VIP, Gaming, Featured (comma separated)"
                />
              </div>
              <div className="md:col-span-2">
                <label className="kos-label">Internal notes</label>
                <textarea
                  className="kos-input min-h-28 resize-y"
                  value={form.notes}
                  onChange={(event) => set("notes", event.target.value)}
                  placeholder="Context the team should know. This is pinned on the record."
                />
                <p className="mt-2 text-xs text-kos-muted">
                  Files and proof reports can be attached immediately after
                  creation.
                </p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-4 sm:px-7">
          <button
            className="kos-btn"
            onClick={step === 0 ? onClose : () => setStep((value) => value - 1)}
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              className="kos-btn-primary"
              disabled={!canContinue}
              onClick={() => setStep((value) => value + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              className="kos-btn-primary"
              disabled={busy || !form.projectName.trim()}
              onClick={submit}
            >
              {busy ? "Creating…" : "Create collaboration"}
            </button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="kos-label">{label}</label>
      <input
        type={type}
        className="kos-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
