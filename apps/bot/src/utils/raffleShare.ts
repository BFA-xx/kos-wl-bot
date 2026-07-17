function slugPart(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (normalized || fallback).slice(0, 72).replace(/-+$/u, "");
}

/** Branded public path; the final id keeps recurring names collision-safe. */
export function publicRafflePath(
  raffleId: number,
  organizationSlug: string,
  projectName: string,
): string {
  if (!Number.isInteger(raffleId) || raffleId < 1) {
    throw new RangeError("Invalid public raffle id.");
  }
  return `/r/${slugPart(organizationSlug, "community")}-x-${slugPart(projectName, "raffle")}-${raffleId}`;
}
