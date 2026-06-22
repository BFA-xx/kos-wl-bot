/**
 * Minimal, dependency-free CSV generation with proper RFC-4180 quoting.
 */
function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/u.test(s)) {
    return `"${s.replace(/"/gu, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // Prepend BOM so Excel reads UTF-8 correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export interface WinnerCsvRow {
  position: number;
  userId: string;
  username: string;
  chain: string | null;
  address: string | null;
  submittedAt: Date | null;
}

export function winnersCsv(rows: WinnerCsvRow[]): string {
  return toCsv(
    ["position", "discord_id", "username", "chain", "wallet_address", "submitted_at"],
    rows.map((r) => [
      r.position,
      r.userId,
      r.username,
      r.chain ?? "",
      r.address ?? "",
      r.submittedAt ? r.submittedAt.toISOString() : "",
    ]),
  );
}

export interface ParticipantCsvRow {
  userId: string;
  username: string;
  enteredAt: Date;
  flagged: boolean;
  flagReason: string | null;
}

export function participantsCsv(rows: ParticipantCsvRow[]): string {
  return toCsv(
    ["discord_id", "username", "entered_at", "flagged", "flag_reason"],
    rows.map((r) => [
      r.userId,
      r.username,
      r.enteredAt.toISOString(),
      r.flagged ? "yes" : "no",
      r.flagReason ?? "",
    ]),
  );
}
