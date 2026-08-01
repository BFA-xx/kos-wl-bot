"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

export function RaffleActions({
  raffleId,
  status,
  canReleaseTeamWallets = false,
}: {
  raffleId: number;
  status: string;
  canReleaseTeamWallets?: boolean;
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
  const [teamWalletPreview, setTeamWalletPreview] = useState<{
    selectionMode: "ROUND_ROBIN" | "RANDOM" | "PRIORITY";
    requiredWallets: number;
    communityWallets: number;
    teamWalletsReserved: number;
    remainingWalletsNeeded: number;
    availableWallets: number;
  } | null>(null);
  const [teamWalletMode, setTeamWalletMode] = useState<
    "ROUND_ROBIN" | "RANDOM" | "PRIORITY"
  >("ROUND_ROBIN");

  const api = (path: string) => `/api/${slug}/raffles/${raffleId}${path}`;

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
    setMsg(null);
    const res = await fetch(api("/team-wallets"));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTeamWalletModal(null);
      setMsg(body.error ?? "Couldn't load the Team Wallet Pool.");
      return;
    }
    setTeamWalletPreview(body);
    setTeamWalletMode(body.selectionMode ?? "ROUND_ROBIN");
  }

  async function confirmTeamWalletFill() {
    setBusy("team-wallets");
    const res = await fetch(api("/team-wallets"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectionMode: teamWalletMode }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setMsg(body.error ?? "Team wallets could not be reserved.");
      return;
    }
    setTeamWalletModal(null);
    setMsg(
      body.selected
        ? `${body.selected} team wallet${body.selected === 1 ? "" : "s"} reserved. Final exports now include Source.`
        : "This raffle already has all required wallets.",
    );
    router.refresh();
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
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/[0.10] bg-[#181818] p-5 shadow-2xl shadow-black/70 sm:rounded-3xl sm:p-6">
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
                    label="Reserved"
                    value={teamWalletPreview.teamWalletsReserved}
                  />
                  <TeamWalletMetric
                    label="Need"
                    value={teamWalletPreview.remainingWalletsNeeded}
                    accent
                  />
                </div>

                {teamWalletModal === "fill" ? (
                  <div className="mt-5">
                    <label className="kos-label" htmlFor="team-wallet-mode">
                      Selection mode
                    </label>
                    <select
                      id="team-wallet-mode"
                      className="kos-input"
                      value={teamWalletMode}
                      onChange={(event) =>
                        setTeamWalletMode(
                          event.target.value as typeof teamWalletMode,
                        )
                      }
                    >
                      <option value="ROUND_ROBIN">Round Robin (default)</option>
                      <option value="RANDOM">Random</option>
                      <option value="PRIORITY">Priority</option>
                    </select>
                    <p className="mt-2 text-xs leading-5 text-kos-muted">
                      {teamWalletPreview.availableWallets} eligible wallet
                      {teamWalletPreview.availableWallets === 1
                        ? " is"
                        : "s are"}{" "}
                      currently available. Community addresses and
                      already-reserved wallets are excluded.
                    </p>
                    {teamWalletPreview.availableWallets <
                    teamWalletPreview.remainingWalletsNeeded ? (
                      <p className="mt-2 text-sm text-amber-300">
                        Add or enable more compatible wallets before filling
                        this raffle.
                      </p>
                    ) : null}
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
                        teamWalletPreview.remainingWalletsNeeded === 0 ||
                        teamWalletPreview.availableWallets <
                          teamWalletPreview.remainingWalletsNeeded
                      }
                      onClick={confirmTeamWalletFill}
                    >
                      {busy === "team-wallets"
                        ? "Reserving…"
                        : `Confirm & reserve ${teamWalletPreview.remainingWalletsNeeded}`}
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
