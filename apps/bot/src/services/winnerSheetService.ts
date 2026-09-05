import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Winner handover sheets, from Discord.
 *
 * The Google account lives on the dashboard side — it is connected per
 * organization through an OAuth flow that needs a browser — so the bot asks
 * the dashboard to build the sheet rather than holding Google credentials of
 * its own. Disabled unless both the dashboard URL and the shared token are
 * configured, in which case `/raffle export` falls back to its CSV.
 */

export interface WinnerSheetResponse {
  url: string;
  rowCount: number;
  raffleIds: number[];
  created: boolean;
  rewritten: boolean;
  duplicatesRemoved: number;
  blocks: { kind: string; rows: number }[];
  failedEditors: string[];
}

export function winnerSheetsEnabled(): boolean {
  return Boolean(config.DASHBOARD_URL && config.BOT_API_TOKEN);
}

export type WinnerSheetOutcome =
  | { ok: true; sheet: WinnerSheetResponse }
  | { ok: false; reason: string };

export async function requestWinnerSheet(input: {
  raffleId: number;
  guildId: string;
  actorId: string;
  rewrite?: boolean;
}): Promise<WinnerSheetOutcome> {
  if (!winnerSheetsEnabled()) {
    return { ok: false, reason: "Google Sheets is not configured." };
  }
  const url = `${config.DASHBOARD_URL!.replace(/\/+$/u, "")}/api/internal/winner-sheet`;
  const controller = new AbortController();
  // Creating a sheet is four Google round-trips; well under Discord's 15
  // minute deferred-reply window, but bounded so the command cannot hang.
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.BOT_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const reason =
        typeof body.error === "string"
          ? body.error
          : `The dashboard returned ${res.status}.`;
      logger.warn(
        { raffleId: input.raffleId, status: res.status, reason },
        "winner sheet request failed",
      );
      return { ok: false, reason };
    }
    return { ok: true, sheet: body as unknown as WinnerSheetResponse };
  } catch (err) {
    logger.warn(
      { err, raffleId: input.raffleId },
      "winner sheet request errored",
    );
    return {
      ok: false,
      reason:
        err instanceof Error && err.name === "AbortError"
          ? "The dashboard took too long to build the sheet."
          : "The dashboard could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
