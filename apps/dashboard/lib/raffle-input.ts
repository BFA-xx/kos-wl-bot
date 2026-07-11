export interface LegacyRaffleTask {
  label: string;
  url?: string;
}

/** Normalize optional external URLs before they reach Discord components. */
export function sanitizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function sanitizeLegacyRaffleTasks(value: unknown): LegacyRaffleTask[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((task): task is { label: unknown; url?: unknown } =>
      Boolean(task && typeof task === "object" && "label" in task),
    )
    .flatMap((task) => {
      const label = typeof task.label === "string" ? task.label.trim() : "";
      if (!label) return [];
      const url = sanitizeHttpUrl(task.url);
      return [{ label: label.slice(0, 80), ...(url ? { url } : {}) }];
    })
    .slice(0, 10);
}
