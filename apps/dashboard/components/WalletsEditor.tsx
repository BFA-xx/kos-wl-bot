"use client";

import useSWR from "swr";
import { useState } from "react";
import { Empty } from "@/components/ui";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const CHAINS = [
  { key: "ETHEREUM", label: "Ethereum", hint: "0x…" },
  { key: "BASE", label: "Base", hint: "0x…" },
  { key: "SOLANA", label: "Solana", hint: "base58 address" },
  { key: "BITCOIN", label: "Bitcoin", hint: "bc1… / 1… / 3…" },
];

interface Wallet {
  chain: string;
  address: string;
  updatedAt: string;
}

/** Add / update / remove payout wallets — web parity with /wallet register. */
export function WalletsEditor() {
  const { data, mutate } = useSWR<{ wallets: Wallet[] }>("/api/me/wallets", fetcher);
  const [chain, setChain] = useState("ETHEREUM");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const wallets = data?.wallets ?? [];
  const byChain = new Map(wallets.map((w) => [w.chain, w]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/me/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, address }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setAddress("");
      setMsg(`${CHAINS.find((c) => c.key === chain)?.label} wallet saved.`);
      mutate();
    } else {
      setMsg(body.error ?? "Couldn't save that address.");
    }
  }

  async function remove(c: string) {
    if (!confirm(`Remove your ${c} wallet?`)) return;
    await fetch(`/api/me/wallets?chain=${c}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="kos-card space-y-3 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-kos-muted">
          Add or update a wallet
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="kos-input sm:max-w-[160px]" value={chain} onChange={(e) => setChain(e.target.value)}>
            {CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            className="kos-input font-mono text-sm"
            placeholder={CHAINS.find((c) => c.key === chain)?.hint}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" disabled={busy || !address.trim()} className="kos-btn-primary whitespace-nowrap disabled:opacity-50">
            {busy ? "Saving…" : byChain.has(chain) ? "Update" : "Add wallet"}
          </button>
        </div>
        {msg ? <p className="text-sm text-kos-muted">{msg}</p> : null}
      </form>

      {!data ? (
        <Empty>Loading…</Empty>
      ) : wallets.length === 0 ? (
        <Empty>No wallets yet. Add one above — some raffles require it to enter.</Empty>
      ) : (
        <div className="space-y-2">
          {wallets.map((w) => (
            <div
              key={w.chain}
              className="flex flex-col gap-2 rounded-xl border border-kos-border bg-kos-panel/50 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {CHAINS.find((c) => c.key === w.chain)?.label ?? w.chain}
                </div>
                <code className="break-all text-xs text-kos-muted">{w.address}</code>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-kos-muted">
                  updated {new Date(w.updatedAt).toLocaleDateString()}
                </span>
                <button onClick={() => remove(w.chain)} className="text-xs text-kos-muted hover:text-red-400">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-kos-muted/70">
        Also works in Discord with <code>/wallet register</code> — it's the same registry.
        Addresses are encrypted at rest and only shared with the community whose raffle you win.
      </p>
    </div>
  );
}
