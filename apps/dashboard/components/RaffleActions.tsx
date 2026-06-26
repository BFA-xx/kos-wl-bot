"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RaffleActions({
  raffleId,
  status,
}: {
  raffleId: number;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "multiple" | "all">("all");
  const [count, setCount] = useState(1);

  async function endNow() {
    if (!confirm("End this raffle now and draw winners?")) return;
    setBusy("end");
    setMsg(null);
    const res = await fetch(`/api/raffles/${raffleId}/end`, { method: "POST" });
    setBusy(null);
    setMsg(res.ok ? "Raffle ended and winners drawn." : "Failed — is the bot running?");
    router.refresh();
  }

  async function reroll() {
    if (!confirm(`Reroll (${mode}) winners for raffle #${raffleId}?`)) return;
    setBusy("reroll");
    setMsg(null);
    const res = await fetch(`/api/raffles/${raffleId}/reroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, count: mode === "multiple" ? count : undefined }),
    });
    setBusy(null);
    setMsg(res.ok ? "Reroll complete." : "Reroll failed — raffle must be ENDED with spare entrants.");
    router.refresh();
  }

  return (
    <div className="kos-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-grey">
        Actions
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <a className="kos-btn" href={`/api/raffles/${raffleId}/export-xlsx?mode=addresses`}>
          Addresses (Excel)
        </a>
        <a className="kos-btn" href={`/api/raffles/${raffleId}/export-xlsx?mode=full`}>
          Winners + Wallets (Excel)
        </a>
        <a className="kos-btn" href={`/api/raffles/${raffleId}/export?type=winners`}>
          Winners CSV
        </a>
        <a className="kos-btn" href={`/api/raffles/${raffleId}/export?type=participants`}>
          Participants CSV
        </a>
        {status !== "ENDED" && status !== "CANCELLED" ? (
          <button className="kos-btn" onClick={endNow} disabled={busy !== null}>
            {busy === "end" ? "Ending…" : "End Now & Draw"}
          </button>
        ) : null}
      </div>

      {status === "ENDED" ? (
        <div className="mt-4 border-t border-kos-line pt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-kos-grey">Reroll</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="kos-input max-w-[180px]"
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

      {msg ? <p className="mt-3 text-sm text-kos-silver">{msg}</p> : null}
    </div>
  );
}
