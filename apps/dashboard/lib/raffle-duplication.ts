import type { DuplicateVariant } from "@/lib/raffle-share";
import { titleForDuplicateVariant } from "@/lib/raffle-share";

const MIN_DURATION_MS = 15 * 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function duplicateSchedule(startAt: Date, endAt: Date) {
  const sourceDuration = endAt.getTime() - startAt.getTime();
  const duration = Math.min(
    MAX_DURATION_MS,
    Math.max(MIN_DURATION_MS, sourceDuration),
  );
  const start = new Date();
  return { startAt: start, endAt: new Date(start.getTime() + duration) };
}

export function duplicateTitle(
  title: string,
  variant: DuplicateVariant,
): string {
  return titleForDuplicateVariant(title, variant);
}

export function parseDuplicateVariant(value: string | null): DuplicateVariant {
  return value === "GTD" || value === "FCFS" ? value : "SAME";
}
