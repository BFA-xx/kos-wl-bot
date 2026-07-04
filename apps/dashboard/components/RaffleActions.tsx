"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

export function RaffleActions({
  raffleId,
  status,
}: {
  raffleId: number;
  status: string;
}) {
  const router = useRouter();
  const { slug } = useOrg();
  const canEnd = useCan(PERMISSIONS.RAFFLE_END);
  const canReroll = useCan(PERMISSIONS.RAFFLE_REROLL);
  const canExportWallets = useCan(PERMISSIONS.WALLET_EXPORT);
  const canExportReports = useCan(PERMISSIONS.REPORT_EXPORT);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"multiple" | "all">("all");
  const [count, setCount] = useState(1);

  const api = (path: string) => `/api/${slug}/raffles/${raffleId}${path}`;

  async function endNow() {
    if (!confirm("End this raffle now and draw winners?")) return;
    setBusy("end");
    setMsg(null);
    const res = await fetch(api(`/end`), { method: "POST" });
    setBusy(null);
    setMsg(res.ok ? "Raffle ended and winners drawn." : "Failed — is the bot running?");
    router.refresh();
  }

  async function reroll() {
    if (!confirm(`Reroll (${mode}) winners for raffle #${raffleId}?`)) return;
    setBusy("reroll");
    setMsg(null);
    const res = await fetch(api(`/reroll`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, count: mode === "multiple" ? count : undefined }),
    });
    setBusy(null);
    setMsg(res.ok ? "Reroll complete." : "Reroll failed — raffle must be ENDED with spare entrants.");
    router.refresh();
  }

  const nothing = !canEnd && !canReroll && !canExportWallets && !canExportReports;
  if (nothing) return null;

  return (
    <div className="kos-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">Actions</h3>

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
      </div>

      {canReroll && status === "ENDED" ? (
        <div className="mt-4 border-t border-kos-border pt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-kos-muted">Reroll</div>
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
            <button className="kos-btn" onClick={reroll} disabled={busy !== null}>
              {busy === "reroll" ? "Rerolling…" : "Reroll"}
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="mt-3 text-sm text-kos-muted">{msg}</p> : null}
    </div>
  );
}
