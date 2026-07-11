export type RaffleKind = "GTD" | "FCFS";
export type DuplicateVariant = "SAME" | RaffleKind;

export const PUBLIC_RAFFLE_ORIGIN =
  process.env.NEXT_PUBLIC_RAFFLE_ORIGIN?.replace(/\/$/u, "") ||
  "https://raffle.koslabs.app";

export function publicRafflePath(raffleId: number): string {
  return `/r/${raffleId}`;
}

export function publicRaffleUrl(raffleId: number): string {
  return `${PUBLIC_RAFFLE_ORIGIN}${publicRafflePath(raffleId)}`;
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
