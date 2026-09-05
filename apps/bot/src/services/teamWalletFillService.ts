import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Team Wallet Pool fills, from Discord.
 *
 * The reservation is a Serializable transaction living in the dashboard, so
 * the bot drives it over the same authenticated internal path the winner sheet
 * uses rather than keeping a second copy of that logic against the same rows.
 */

export type SelectionMode = "ROUND_ROBIN" | "RANDOM" | "PRIORITY";

export interface FillPreview {
  raffle: { id: number; projectName: string; title: string; status: string };
  selectionMode: SelectionMode;
  requiredWallets: number;
  communityWallets: number;
  teamWalletsReserved: number;
  remainingWalletsNeeded: number;
  availableWallets: number;
  maxSelectable: number;
  selectedCount: number;
  selectedWallets: {
    id: string;
    address: string;
    ownerName: string;
    chain: string;
  }[];
}

export interface FillResult {
  selected: number;
  community: number;
  remaining: number;
  mode: SelectionMode;
  wallets: { address: string; ownerName: string; chain: string }[];
}

export type FillOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export function teamWalletFillEnabled(): boolean {
  return Boolean(config.DASHBOARD_URL && config.BOT_API_TOKEN);
}

async function call<T>(body: Record<string, unknown>): Promise<FillOutcome<T>> {
  if (!teamWalletFillEnabled()) {
    return {
      ok: false,
      reason:
        "Team wallet fills from Discord are not configured on this server.",
    };
  }
  const url = `${config.DASHBOARD_URL!.replace(/\/+$/u, "")}/api/internal/team-wallets`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.BOT_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const reason =
        typeof json.error === "string"
          ? json.error
          : `The dashboard returned ${res.status}.`;
      logger.warn(
        { status: res.status, reason, body },
        "team wallet fill failed",
      );
      return { ok: false, reason };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    logger.warn({ err, body }, "team wallet fill errored");
    return {
      ok: false,
      reason:
        err instanceof Error && err.name === "AbortError"
          ? "The dashboard took too long to answer."
          : "The dashboard could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function previewFill(input: {
  raffleId: number;
  guildId: string;
  actorId: string;
  count?: number | null;
  selectionMode?: SelectionMode | null;
}): Promise<FillOutcome<FillPreview>> {
  return call<FillPreview>({
    action: "preview",
    raffleId: input.raffleId,
    guildId: input.guildId,
    actorId: input.actorId,
    ...(input.count == null ? {} : { count: input.count }),
    ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
  });
}

export function confirmFill(input: {
  raffleId: number;
  guildId: string;
  actorId: string;
  count: number;
  selectionMode: SelectionMode;
}): Promise<FillOutcome<FillResult>> {
  return call<FillResult>({ action: "confirm", ...input });
}
