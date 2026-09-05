"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

type TeamWalletMode = "ROUND_ROBIN" | "RANDOM" | "PRIORITY";

export interface WinnerSheetSummary {
  url: string;
  rowCount: number;
  syncedAt: string;
  raffleIds: number[];
  missingRaffleIds: number[];
  stale: boolean;
}

interface TeamWalletPreview {
  selectionMode: TeamWalletMode;
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
    ownerId: string;
    ownerName: string;
    chain: string;
    version: string;
  }[];
}

export function RaffleActions({
  raffleId,
  status,
  canReleaseTeamWallets = false,
  winnerSheet = null,
}: {
  raffleId: number;
  status: string;
  canReleaseTeamWallets?: boolean;
  winnerSheet?: WinnerSheetSummary | null;
}) {
  const router = useRouter();
  const { slug } = useOrg();
  const canEnd = useCan(PERMISSIONS.RAFFLE_END);
  const canEdit = useCan(PERMISSIONS.RAFFLE_EDIT);
  const canReroll = useCan(PERMISSIONS.RAFFLE_REROLL);
  const canExportWallets = useCan(PERMISSIONS.WALLET_EXPORT);
  const canExportReports = useCan(PERMISSIONS.REPORT_EXPORT);
  const canFillTeamWallets = useCan(PERMISSIONS.TEAM_WALLET_FILL);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"multiple" | "all">("all");
  const [count, setCount] = useState(1);
  const [teamWalletModal, setTeamWalletModal] = useState<
    "fill" | "release" | null
  >(null);
  const [teamWalletPreview, setTeamWalletPreview] =
    useState<TeamWalletPreview | null>(null);
  const [teamWalletMode, setTeamWalletMode] =
    useState<TeamWalletMode>("ROUND_ROBIN");
  const [teamWalletCount, setTeamWalletCount] = useState(0);
  const [teamWalletPreviewLoading, setTeamWalletPreviewLoading] =
    useState(false);
  const [teamWalletError, setTeamWalletError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<WinnerSheetSummary | null>(winnerSheet);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const api = (path: string) => `/api/${slug}/raffles/${raffleId}${path}`;

  /**
   * Open the winners sheet, creating it on first use.
   *
   * The tab is opened synchronously on the click and only navigated once the
   * URL comes back — opening it after the await is what browsers block as a
   * popup.
   */
  async function openSheet(rewrite: boolean) {
    if (
      rewrite &&
      !confirm(
        "Rewrite the sheet from the current winners? Anything the team edited in it will be replaced.",
      )
    ) {
      return;
    }
    setSheetError(null);
    const tab = window.open("", "_blank", "noopener");
    setBusy("sheet");
    const res = await fetch(api("/sheet"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rewrite }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      tab?.close();
      setSheetError(body.error ?? "Couldn't open the winners sheet.");
      return;
    }
    setSheet({
      url: body.url,
      rowCount: body.rowCount,
      syncedAt: body.syncedAt,
      raffleIds: body.raffleIds ?? [],
      missingRaffleIds: body.missingRaffleIds ?? [],
      stale: Boolean(body.stale),
    });
    if (body.failedEditors?.length) {
      setSheetError(
        `Sheet ready, but Google would not grant edit access to ${body.failedEditors.join(", ")}. Check the addresses in Settings → Google Sheets.`,
      );
    }
    if (tab) tab.location.href = body.url;
    else window.location.href = body.url;
    router.refresh();
  }

  async function endNow() {
    if (!confirm("End this raffle now and draw winners?")) return;
    setBusy("end");
    setMsg(null);
    const res = await fetch(api(`/end`), { method: "POST" });
    setBusy(null);
    setMsg(
      res.ok
        ? "Ending now — the bot will draw winners in a few seconds."
        : "Failed to queue the end.",
    );
    router.refresh();
  }

  async function reroll() {
    if (!confirm(`Reroll (${mode}) winners for raffle #${raffleId}?`)) return;
    setBusy("reroll");
    setMsg(null);
    const res = await fetch(api(`/reroll`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        count: mode === "multiple" ? count : undefined,
      }),
    });
    setBusy(null);
    setMsg(
      res.ok
        ? "Reroll queued — the bot will process it shortly."
        : "Reroll failed — raffle must be ENDED with spare entrants.",
    );
    router.refresh();
  }

  async function repost() {
    setBusy("repost");
    setMsg(null);
    const res = await fetch(api("/repost"), { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(
      res.ok
        ? "Repost queued — the bot will publish it in a few seconds."
        : (body.error ?? "Couldn't queue the repost."),
    );
    router.refresh();
  }

  async function openTeamWalletModal(kind: "fill" | "release") {
    setTeamWalletModal(kind);
    setTeamWalletPreview(null);
    setTeamWalletError(null);
    setMsg(null);
    await loadTeamWalletPreview(null, null, true);
  }

  async function loadTeamWalletPreview(
    count: number | null,
    selectionMode: TeamWalletMode | null,
    closeOnError = false,
  ) {
    setTeamWalletPreviewLoading(true);
    setTeamWalletError(null);
    const search = new URLSearchParams();
    if (count !== null) search.set("count", String(count));
    if (selectionMode) search.set("selectionMode", selectionMode);
    const res = await fetch(
      api(`/team-wallets${search.size ? `?${search.toString()}` : ""}`),
    );
    const body = await res.json().catch(() => ({}));
    setTeamWalletPreviewLoading(false);
    if (!res.ok) {
      const error = body.error ?? "Couldn't load the Team Wallet Pool.";
      if (closeOnError) {
        setTeamWalletModal(null);
        setMsg(error);
      } else {
        setTeamWalletError(error);
      }
      return;
    }
    setTeamWalletPreview(body);
    setTeamWalletMode(body.selectionMode ?? "ROUND_ROBIN");
    setTeamWalletCount(body.selectedCount ?? 0);
  }

  async function confirmTeamWalletFill() {
    if (!teamWalletPreview) return;
    setBusy("team-wallets");
    setTeamWalletError(null);
    const res = await fetch(api("/team-wallets"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectionMode: teamWalletMode,
        count: teamWalletCount,
        wallets: teamWalletPreview.selectedWallets.map((wallet) => ({
          id: wallet.id,
          version: wallet.version,
        })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setTeamWalletError(body.error ?? "Team wallets could not be reserved.");
      return;
    }
    setTeamWalletModal(null);
    setMsg(
      body.selected
        ? `${body.selected} team wallet${body.selected === 1 ? "" : "s"} reserved. ${body.remaining} slot${body.remaining === 1 ? " remains" : "s remain"}.`
        : "This raffle already has all required wallets.",
    );
    router.refresh();
  }

  function updateTeamWalletCount(next: number) {
    if (
      !teamWalletPreview ||
      teamWalletPreview.maxSelectable === 0 ||
      !Number.isFinite(next)
    )
      return;
    setTeamWalletCount(
      Math.min(teamWalletPreview.maxSelectable, Math.max(1, next)),
    );
    setTeamWalletError(null);
  }

  async function confirmTeamWalletRelease() {
    setBusy("team-wallets");
    const res = await fetch(api("/team-wallets/release"), { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMsg(body.error ?? "Reserved wallets could not be released.");
      return;
    }
    setTeamWalletModal(null);
    setMsg(
      `${body.released} team wallet${body.released === 1 ? "" : "s"} released back to the pool.`,
    );
    router.refresh();
  }

  const canRepost = canEdit && status === "CANCELLED";
  const canShowTeamWalletFill = canFillTeamWallets && status === "ENDED";
  const canShowTeamWalletRelease =
    canReleaseTeamWallets && status === "CANCELLED";
  const teamWalletPreviewIsCurrent = Boolean(
    teamWalletPreview &&
    teamWalletPreview.selectedCount === teamWalletCount &&
    teamWalletPreview.selectionMode === teamWalletMode,
  );
  const nothing =
    !canEnd &&
    !canRepost &&
    !canReroll &&
    !canExportWallets &&
    !canExportReports &&
    !canShowTeamWalletFill &&
    !canShowTeamWalletRelease;
  if (nothing) return null;

  return (
    <div className="kos-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">
        Actions
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        {canExportWallets ? (
          <>
            <button
              className="kos-btn-primary"
              onClick={() => void openSheet(false)}
              disabled={busy !== null}
            >
              {busy === "sheet"
                ? sheet
                  ? "Opening…"
                  : "Building sheet…"
                : sheet
                  ? "Open winners sheet"
                  : "Open in Google Sheets"}
            </button>
            <a className="kos-btn" href={api(`/export-xlsx?mode=addresses`)}>
              Addresses (Excel)
            </a>
            <a className="kos-btn" href={api(`/export-xlsx?mode=full`)}>
              Winners + Wallets (Excel)
            </a>
            <a className="kos-btn" href={api(`/export?type=winners`)}>
              Winners CSV
            </a>
          </>
        ) : null}
        {canExportReports ? (
          <a className="kos-btn" href={api(`/export?type=participants`)}>
            Participants CSV
          </a>
        ) : null}
        {canEnd && status !== "ENDED" && status !== "CANCELLED" ? (
          <button className="kos-btn" onClick={endNow} disabled={busy !== null}>
            {busy === "end" ? "Ending…" : "End Now & Draw"}
          </button>
        ) : null}
        {canShowTeamWalletFill ? (
          <button
            className="kos-btn-primary"
            onClick={() => void openTeamWalletModal("fill")}
            disabled={busy !== null}
          >
            Fill Team Wallets
          </button>
        ) : null}
        {canShowTeamWalletRelease ? (
          <button
            className="kos-btn"
            onClick={() => void openTeamWalletModal("release")}
            disabled={busy !== null}
          >
            Release Team Wallets
          </button>
        ) : null}
        {canRepost ? (
          <button
            className="kos-btn-primary"
            onClick={repost}
            disabled={busy !== null}
          >
            {busy === "repost" ? "Queuing…" : "Repost raffle"}
          </button>
        ) : null}
      </div>

      {canExportWallets && (sheet || sheetError) ? (
        <div className="mt-3 space-y-2 text-sm">
          {sheet ? (
            <p className="text-kos-muted">
              Google Sheet · {sheet.rowCount} address
              {sheet.rowCount === 1 ? "" : "es"}
              {sheet.raffleIds.length > 1
                ? ` from raffles ${sheet.raffleIds.map((id) => `#${id}`).join(" + ")}, GTD first`
                : ""}{" "}
              · synced {new Date(sheet.syncedAt).toLocaleString()}
            </p>
          ) : null}
          {sheet && (sheet.stale || sheet.missingRaffleIds.length > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-amber-200">
              <span>
                {sheet.missingRaffleIds.length > 0
                  ? `Raffle${sheet.missingRaffleIds.length === 1 ? "" : "s"} ${sheet.missingRaffleIds
                      .map((id) => `#${id}`)
                      .join(
                        ", ",
                      )} ${sheet.missingRaffleIds.length === 1 ? "was" : "were"} drawn after this sheet was written.`
                  : "Winners or wallets changed after this sheet was written."}
              </span>
              <button
                className="kos-btn shrink-0"
                onClick={() => void openSheet(true)}
                disabled={busy !== null}
              >
                {busy === "sheet" ? "Rewriting…" : "Rewrite sheet"}
              </button>
            </div>
          ) : null}
          {sheetError ? (
            <p className="rounded-2xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-red-200">
              {sheetError}
            </p>
          ) : null}
        </div>
      ) : null}

      {canReroll && status === "ENDED" ? (
        <div className="mt-4 border-t border-kos-border pt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-kos-muted">
            Reroll
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="kos-input max-w-[200px]"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="all">Entire winner pool</option>
              <option value="multiple">Multiple winners</option>
            </select>
            {mode === "multiple" ? (
              <input
                type="number"
                min={1}
                className="kos-input max-w-[100px]"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            ) : null}
            <button
              className="kos-btn"
              onClick={reroll}
              disabled={busy !== null}
            >
              {busy === "reroll" ? "Rerolling…" : "Reroll"}
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="mt-3 text-sm text-kos-muted">{msg}</p> : null}

      {teamWalletModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-wallet-modal-title"
          className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busy === null) {
              setTeamWalletModal(null);
            }
          }}
        >
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/[0.10] bg-[#181818] p-5 shadow-2xl shadow-black/70 sm:rounded-3xl sm:p-6">
            <h2 id="team-wallet-modal-title" className="text-xl font-semibold">
              {teamWalletModal === "fill"
                ? "Fill Team Wallets"
                : "Release Team Wallets"}
            </h2>
            {!teamWalletPreview ? (
              <div className="mt-6 rounded-2xl border border-white/[0.08] p-5 text-center text-sm text-kos-muted">
                Calculating wallet availability…
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <TeamWalletMetric
                    label="Required"
                    value={teamWalletPreview.requiredWallets}
                  />
                  <TeamWalletMetric
                    label="Community"
                    value={teamWalletPreview.communityWallets}
                  />
                  <TeamWalletMetric
                    label="Team Wallets"
                    value={
                      teamWalletPreview.teamWalletsReserved +
                      (teamWalletModal === "fill" ? teamWalletCount : 0)
                    }
                  />
                  <TeamWalletMetric
                    label="Remaining"
                    value={Math.max(
                      0,
                      teamWalletPreview.remainingWalletsNeeded -
                        (teamWalletModal === "fill" ? teamWalletCount : 0),
                    )}
                    accent
                  />
                </div>

                {teamWalletModal === "fill" ? (
                  <div className="mt-5 space-y-5">
                    <div>
                      <label className="kos-label" htmlFor="team-wallet-count">
                        Team wallets to add
                      </label>
                      <div className="grid grid-cols-[3rem_minmax(5rem,1fr)_3rem] gap-2 sm:max-w-xs">
                        <button
                          type="button"
                          className="kos-btn justify-center px-0 text-xl"
                          aria-label="Remove one team wallet"
                          disabled={
                            teamWalletPreviewLoading || teamWalletCount <= 1
                          }
                          onClick={() =>
                            updateTeamWalletCount(teamWalletCount - 1)
                          }
                        >
                          −
                        </button>
                        <input
                          id="team-wallet-count"
                          type="number"
                          className="kos-input text-center text-lg font-semibold"
                          min={teamWalletPreview.maxSelectable ? 1 : 0}
                          max={teamWalletPreview.maxSelectable}
                          disabled={teamWalletPreview.maxSelectable === 0}
                          value={teamWalletCount}
                          onChange={(event) =>
                            updateTeamWalletCount(Number(event.target.value))
                          }
                        />
                        <button
                          type="button"
                          className="kos-btn justify-center px-0 text-xl"
                          aria-label="Add one team wallet"
                          disabled={
                            teamWalletPreviewLoading ||
                            teamWalletCount >= teamWalletPreview.maxSelectable
                          }
                          onClick={() =>
                            updateTeamWalletCount(teamWalletCount + 1)
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="kos-label" htmlFor="team-wallet-mode">
                        Selection mode
                      </label>
                      <select
                        id="team-wallet-mode"
                        className="kos-input"
                        value={teamWalletMode}
                        onChange={(event) => {
                          setTeamWalletMode(
                            event.target.value as typeof teamWalletMode,
                          );
                          setTeamWalletError(null);
                        }}
                      >
                        <option value="ROUND_ROBIN">
                          Round Robin (default)
                        </option>
                        <option value="RANDOM">Random</option>
                        <option value="PRIORITY">Priority</option>
                      </select>
                    </div>

                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium">
                            {teamWalletPreview.availableWallets} eligible wallet
                            {teamWalletPreview.availableWallets === 1
                              ? ""
                              : "s"}{" "}
                            available
                          </div>
                          <p className="mt-1 text-xs leading-5 text-kos-muted">
                            Compatible, valid team-pool wallets from every
                            member; community duplicates, disabled wallets,
                            active raffle reservations, and wallets already used
                            here are excluded.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="kos-btn shrink-0 justify-center"
                          disabled={
                            teamWalletPreviewLoading || teamWalletCount === 0
                          }
                          onClick={() =>
                            void loadTeamWalletPreview(
                              teamWalletCount,
                              teamWalletMode,
                            )
                          }
                        >
                          {teamWalletPreviewLoading
                            ? "Generating…"
                            : teamWalletPreviewIsCurrent
                              ? "Regenerate selection"
                              : "Preview selection"}
                        </button>
                      </div>
                      {teamWalletPreview.maxSelectable <
                      teamWalletPreview.remainingWalletsNeeded ? (
                        <p className="mt-3 text-sm text-amber-300">
                          Only {teamWalletPreview.maxSelectable} eligible team
                          wallet
                          {teamWalletPreview.maxSelectable === 1
                            ? " is"
                            : "s are"}{" "}
                          currently available, so that is the maximum for this
                          fill.
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <TeamWalletSummary
                        label="Team Wallets to Add"
                        value={teamWalletCount}
                      />
                      <TeamWalletSummary
                        label="Available"
                        value={teamWalletPreview.availableWallets}
                      />
                      <TeamWalletSummary
                        label="Selection Mode"
                        value={teamWalletModeLabel(teamWalletMode)}
                      />
                    </div>

                    {teamWalletError ? (
                      <p className="rounded-2xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">
                        {teamWalletError}
                      </p>
                    ) : null}

                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">
                          Selected Wallets
                        </h3>
                        <span className="text-xs text-kos-muted">
                          Selected: {teamWalletCount} /{" "}
                          {teamWalletPreview.remainingWalletsNeeded} remaining
                        </span>
                      </div>
                      {!teamWalletPreviewIsCurrent ? (
                        <div className="mt-2 rounded-2xl border border-dashed border-white/[0.12] p-4 text-sm text-kos-muted">
                          Preview the updated count and selection mode before
                          confirming.
                        </div>
                      ) : (
                        <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                          {teamWalletPreview.selectedWallets.map((wallet) => (
                            <div
                              key={wallet.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5 text-sm"
                            >
                              <span
                                className="min-w-0 truncate font-mono text-xs"
                                title={wallet.address}
                              >
                                {shortWalletAddress(wallet.address)}
                              </span>
                              <span className="shrink-0 text-right text-xs text-kos-muted">
                                {wallet.ownerName}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 text-sm leading-6 text-kos-muted">
                    Release all wallets reserved by this cancelled raffle back
                    to Available. The released history will remain visible.
                  </p>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="kos-btn"
                    disabled={busy !== null}
                    onClick={() => setTeamWalletModal(null)}
                  >
                    Cancel
                  </button>
                  {teamWalletModal === "fill" ? (
                    <button
                      type="button"
                      className="kos-btn-primary"
                      disabled={
                        busy !== null ||
                        teamWalletPreviewLoading ||
                        teamWalletCount === 0 ||
                        !teamWalletPreviewIsCurrent
                      }
                      onClick={confirmTeamWalletFill}
                    >
                      {busy === "team-wallets"
                        ? "Reserving…"
                        : `Confirm & Reserve ${teamWalletCount}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="kos-btn-primary"
                      disabled={
                        busy !== null ||
                        teamWalletPreview.teamWalletsReserved === 0
                      }
                      onClick={confirmTeamWalletRelease}
                    >
                      {busy === "team-wallets"
                        ? "Releasing…"
                        : `Release ${teamWalletPreview.teamWalletsReserved}`}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeamWalletMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${
        accent
          ? "border-blue-400/25 bg-blue-500/10"
          : "border-white/[0.08] bg-white/[0.025]"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-kos-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function TeamWalletSummary({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-black/10 p-3">
      <div className="text-[9px] uppercase tracking-[0.13em] text-kos-muted">
        {label}
      </div>
      <div
        className="mt-1 truncate text-sm font-semibold"
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
}

function teamWalletModeLabel(mode: TeamWalletMode): string {
  if (mode === "ROUND_ROBIN") return "Round Robin";
  if (mode === "RANDOM") return "Random";
  return "Priority";
}

function shortWalletAddress(address: string): string {
  return address.length > 18
    ? `${address.slice(0, 8)}…${address.slice(-8)}`
    : address;
}
