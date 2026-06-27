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
      return "border-emerald-400/30 text-emerald-300/90";
    case "UPCOMING":
      return "border-white/20 text-white/80";
    case "ENDED":
      return "border-white/10 text-white/40";
    case "CANCELLED":
      return "border-white/10 text-white/30 line-through";
    default:
      return "border-white/10 text-white/40";
  }
}

export function shortId(id: number): string {
  return `#${id}`;
}
