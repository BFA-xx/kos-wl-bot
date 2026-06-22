/**
 * Duration / time helpers for raffle scheduling and display.
 */

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a human duration like "24h", "30m", "2d", "1w", "90s", "1d12h" into
 * milliseconds. Also accepts the literal "now" (returns 0). Returns null on
 * an unparseable input.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "now" || trimmed === "0") return 0;

  const re = /(\d+)\s*(w|d|h|m|s)/gu;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    total += Number(m[1]) * UNIT_MS[m[2]!]!;
  }
  return matched ? total : null;
}

/**
 * Resolve a start/end input into an absolute Date.
 * Accepts: "now", a duration (relative to `from`), a unix seconds/ms number,
 * or an ISO timestamp.
 */
export function resolveTime(input: string, from: Date = new Date()): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const dur = parseDuration(trimmed);
  if (dur !== null) return new Date(from.getTime() + dur);

  // Unix epoch (seconds or ms)
  if (/^\d{10,13}$/u.test(trimmed)) {
    const n = Number(trimmed);
    return new Date(trimmed.length <= 10 ? n * 1000 : n);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a clock time: "17:00", "5pm", "5:30pm", "9 am", or a bare hour "17".
 * Returns {h, m} in 24h, or null if unparseable.
 */
export function parseClock(input: string): { h: number; m: number } | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  let m = /^(\d{1,2}):(\d{2})$/u.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h < 24 && mm < 60) return { h, m: mm };
  }
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/u.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    const mm = m[2] ? Number(m[2]) : 0;
    if (h < 24 && mm < 60) return { h, m: mm };
  }
  m = /^(\d{1,2})$/u.exec(s);
  if (m) {
    const h = Number(m[1]);
    if (h < 24) return { h, m: 0 };
  }
  return null;
}

/**
 * Resolve a start moment from separate Date + Time inputs (as typed in the
 * raffle modal). Date accepts: "now", "today", "tomorrow", "YYYY-MM-DD", or any
 * Date-parseable string. Time accepts anything parseClock handles, or blank.
 * Interpreted in the bot host's local timezone (set TZ on the server).
 */
export function resolveStart(
  dateStr: string,
  timeStr: string,
  now: Date = new Date(),
): Date | null {
  const d = (dateStr ?? "").trim().toLowerCase();
  if (!d || d === "now") return now;

  let base: Date | null = null;
  if (d === "today") {
    base = new Date(now);
  } else if (d === "tomorrow") {
    base = new Date(now);
    base.setDate(base.getDate() + 1);
  } else {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(d);
    if (m) base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    else {
      const parsed = new Date(dateStr);
      if (!Number.isNaN(parsed.getTime())) base = parsed;
    }
  }
  if (!base) return null;

  const t = (timeStr ?? "").trim().toLowerCase();
  if (t && t !== "now") {
    const clock = parseClock(t);
    if (!clock) return null;
    base.setHours(clock.h, clock.m, 0, 0);
  }
  return base;
}

/**
 * Flexible "when" parser for a single combined field. Accepts everything
 * resolveTime handles (now, durations, ISO, "YYYY-MM-DD HH:MM", epoch) plus
 * "<date> <time>" combos like "tomorrow 5pm" and bare times like "17:00".
 */
export function resolveWhen(input: string, from: Date = new Date()): Date | null {
  const t = (input ?? "").trim();
  if (!t) return null;

  const direct = resolveTime(t, from);
  if (direct) return direct;

  const parts = t.split(/\s+/u);
  if (parts.length >= 2) {
    const timePart = parts[parts.length - 1]!;
    const datePart = parts.slice(0, -1).join(" ");
    const combo = resolveStart(datePart, timePart, from);
    if (combo) return combo;
  }
  // Single token that wasn't a duration/date — try it as a time today.
  return resolveStart("today", t, from);
}

/** Discord relative timestamp, e.g. <t:1700000000:R> ("in 3 hours"). */
export function discordRelative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/** Discord full timestamp, e.g. <t:1700000000:F>. */
export function discordFull(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

/** Compact human countdown like "2d 4h 13m" or "Ended". */
export function formatCountdown(target: Date, now: Date = new Date()): string {
  let ms = target.getTime() - now.getTime();
  if (ms <= 0) return "Ended";

  const d = Math.floor(ms / UNIT_MS.d!);
  ms -= d * UNIT_MS.d!;
  const h = Math.floor(ms / UNIT_MS.h!);
  ms -= h * UNIT_MS.h!;
  const m = Math.floor(ms / UNIT_MS.m!);

  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/** Human duration between two dates, e.g. "24 Hours", "3 Days". */
export function humanDuration(start: Date, end: Date): string {
  const ms = Math.max(0, end.getTime() - start.getTime());
  const hours = Math.round(ms / UNIT_MS.h!);
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} Days`;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} Days`;
  if (hours >= 1) return `${hours} Hours`;
  const mins = Math.round(ms / UNIT_MS.m!);
  return `${mins} Minutes`;
}
