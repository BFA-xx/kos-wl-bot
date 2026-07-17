export type RaffleKind = "GTD" | "FCFS";
export type DuplicateVariant = "SAME" | RaffleKind;

export interface PublicRaffleIdentity {
  raffleId: number;
  organizationSlug: string;
  projectName: string;
}

export const DEFAULT_PUBLIC_RAFFLE_ORIGIN = "https://raffle.koslabs.app";
export const PUBLIC_RAFFLE_STATUSES = ["UPCOMING", "LIVE", "ENDED"] as const;

/** Normalize the configured share origin to one safe HTTP(S) origin. */
export function normalizePublicRaffleOrigin(value?: string): string {
  try {
    const url = new URL(value?.trim() || DEFAULT_PUBLIC_RAFFLE_ORIGIN);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_PUBLIC_RAFFLE_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_RAFFLE_ORIGIN;
  }
}

export const PUBLIC_RAFFLE_ORIGIN = normalizePublicRaffleOrigin(
  process.env.NEXT_PUBLIC_RAFFLE_ORIGIN,
);

/** Raffle ids are global PostgreSQL `Int` identities and public identifiers. */
export function parsePublicRaffleId(value: string | number): number | null {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/u.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

/** Accept both the legacy numeric reference and the branded canonical form. */
export function parsePublicRaffleReference(value: string): number | null {
  const raw = value.trim();
  if (/^\d+$/u.test(raw)) return parsePublicRaffleId(raw);
  const match = raw.match(/-(\d+)$/u);
  return match ? parsePublicRaffleId(match[1]) : null;
}

export function raffleSlugPart(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (normalized || fallback).slice(0, 72).replace(/-+$/u, "");
}

export function publicRaffleReference({
  raffleId,
  organizationSlug,
  projectName,
}: PublicRaffleIdentity): string {
  const id = parsePublicRaffleId(raffleId);
  if (!id) throw new RangeError("Invalid public raffle id.");
  const community = raffleSlugPart(organizationSlug, "community");
  const raffle = raffleSlugPart(projectName, "raffle");
  return `${community}-x-${raffle}-${id}`;
}

export function publicRafflePath(identity: PublicRaffleIdentity): string {
  return `/r/${publicRaffleReference(identity)}`;
}

export function publicRaffleUrl(identity: PublicRaffleIdentity): string {
  return `${PUBLIC_RAFFLE_ORIGIN}${publicRafflePath(identity)}`;
}

/**
 * Rewrite an internally persisted banner route onto the canonical raffle
 * origin. This repairs records written with a temporary/retired deployment
 * hostname while leaving genuine external project images unchanged.
 */
export function canonicalRaffleBannerUrl(
  raffleId: number,
  value: unknown,
): string | null {
  const id = parsePublicRaffleId(raffleId);
  if (!id || typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname === `/r/${id}/banner`) {
      return `${PUBLIC_RAFFLE_ORIGIN}${url.pathname}${url.search}`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function inferRaffleKind(title: string): RaffleKind | null {
  const match = title.match(/\b(GTD|FCFS)\b/iu);
  return match ? (match[1].toUpperCase() as RaffleKind) : null;
}

export function titleForDuplicateVariant(
  title: string,
  variant: DuplicateVariant,
): string {
  if (variant === "SAME") return title;
  if (/\b(GTD|FCFS)\b/iu.test(title)) {
    return title.replace(/\b(GTD|FCFS)\b/iu, variant);
  }
  return `${variant} ${title}`.trim();
}
