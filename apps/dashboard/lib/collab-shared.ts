export const COLLAB_STATUSES = [
  "LEAD",
  "REACHED_OUT",
  "NEGOTIATING",
  "CONFIRMED",
  "SCHEDULED",
  "HOSTING",
  "COLLECTING_WALLETS",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CollabStatus = (typeof COLLAB_STATUSES)[number];

export const COLLAB_STATUS_LABELS: Record<CollabStatus, string> = {
  LEAD: "Lead",
  REACHED_OUT: "Reached out",
  NEGOTIATING: "Negotiating",
  CONFIRMED: "Confirmed",
  SCHEDULED: "Scheduled",
  HOSTING: "Hosting",
  COLLECTING_WALLETS: "Collecting wallets",
  READY_FOR_SUBMISSION: "Ready for submission",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const COLLAB_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type CollabPriority = (typeof COLLAB_PRIORITIES)[number];

export const COLLAB_PRIORITY_LABELS: Record<CollabPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const ACTIVE_COLLAB_STATUSES: CollabStatus[] = COLLAB_STATUSES.filter(
  (status) => status !== "COMPLETED" && status !== "CANCELLED",
);

export function isCollabStatus(value: unknown): value is CollabStatus {
  return (
    typeof value === "string" &&
    (COLLAB_STATUSES as readonly string[]).includes(value)
  );
}

export function isCollabPriority(value: unknown): value is CollabPriority {
  return (
    typeof value === "string" &&
    (COLLAB_PRIORITIES as readonly string[]).includes(value)
  );
}

export function collabStatusTone(status: string): string {
  if (status === "COMPLETED" || status === "READY_FOR_SUBMISSION") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  }
  if (status === "CANCELLED") {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }
  if (status === "HOSTING" || status === "SUBMITTED") {
    return "border-blue-400/25 bg-blue-400/10 text-blue-300";
  }
  if (status === "NEGOTIATING" || status === "COLLECTING_WALLETS") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  }
  return "border-white/[0.10] bg-white/[0.04] text-kos-muted";
}

export function normalizeCollabName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function toOptionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function displayCollabStatus(status: string): string {
  return (
    COLLAB_STATUS_LABELS[status as CollabStatus] ?? status.replaceAll("_", " ")
  );
}
