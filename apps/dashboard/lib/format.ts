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
      return "border-kos-silver/60 text-kos-white";
    case "UPCOMING":
      return "border-kos-grey/50 text-kos-silver";
    case "ENDED":
      return "border-kos-line text-kos-grey";
    case "CANCELLED":
      return "border-kos-line text-kos-grey line-through";
    default:
      return "border-kos-line text-kos-grey";
  }
}

export function shortId(id: number): string {
  return `#${id}`;
}
