import { createHash } from "crypto";

export const LEGACY_TASK_CLICK = "SOCIAL_TASK_CLICK";
export const LEGACY_TASK_VERIFY = "SOCIAL_TASK_VERIFY";

export interface LegacyRaffleTask {
  id: string;
  key: string;
  label: string;
  url: string | null;
}

/** Legacy raffle social/link tasks are stored in `raffle.requirements.tasks`. */
export function getLegacyRaffleTasks(raffleId: number, requirements: unknown): LegacyRaffleTask[] {
  const req = (requirements ?? {}) as { tasks?: unknown };
  if (!Array.isArray(req.tasks)) return [];

  return req.tasks.flatMap((task, index) => {
    if (!task || typeof task !== "object") return [];
    const t = task as { label?: unknown; url?: unknown };
    if (typeof t.label !== "string" || !t.label.trim()) return [];

    const label = t.label.trim();
    const url = typeof t.url === "string" && t.url.trim() ? t.url.trim() : null;
    const hash = legacyTaskHash(label, url);
    return [
      {
        id: `social-${raffleId}-${index}-${hash}`,
        key: legacyTaskKey(raffleId, index, hash),
        label,
        url,
      },
    ];
  });
}

export function parseLegacyTaskId(id: string): { raffleId: number; index: number; hash: string } | null {
  const match = /^social-(\d+)-(\d+)-([a-f0-9]{12})$/.exec(id);
  if (!match) return null;
  return { raffleId: Number(match[1]), index: Number(match[2]), hash: match[3] };
}

export function legacyTaskKey(raffleId: number, index: number, hash: string): string {
  return `legacy:${raffleId}:${index}:${hash}`;
}

function legacyTaskHash(label: string, url: string | null): string {
  return createHash("sha1").update(`${label}\n${url ?? ""}`).digest("hex").slice(0, 12);
}
