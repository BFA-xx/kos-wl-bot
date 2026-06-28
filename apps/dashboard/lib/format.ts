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
      return "border-kos-border text-kos-fg/80";
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
