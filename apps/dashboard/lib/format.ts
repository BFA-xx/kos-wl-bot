export function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusClasses(status: string): string {
  switch (status) {
    case "LIVE":
      return "border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90";
    case "UPCOMING":
    case "SCHEDULED":
      return "border-kos-border text-kos-fg/80";
    case "SENT":
    case "VALID":
      return "border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90";
    case "FAILED":
    case "INVALID":
      return "border-rose-400/30 text-rose-500 dark:text-rose-300/90";
    case "PENDING":
    case "DRAFT":
      return "border-amber-400/30 text-amber-500 dark:text-amber-300/90";
    case "DUPLICATE":
      return "border-violet-400/30 text-violet-500 dark:text-violet-300/90";
    case "ENDED":
      return "border-kos-border text-kos-muted";
    case "CANCELLED":
      return "border-kos-border text-kos-muted line-through";
    default:
      return "border-kos-border text-kos-muted";
  }
}

export function shortId(id: number): string {
  return `#${id}`;
}
