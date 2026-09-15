"use client";

import useSWR from "swr";
import { useState } from "react";
import { Empty } from "@/components/ui";
import {
  EVM_CHAINS,
  EVM_FAMILY_KEY,
  WALLET_CHAINS,
  walletChainHint,
  walletChainLabel,
  walletFamily,
} from "@/lib/wallet-validation";

const fetcher = (u: string) => fetch(u).then((r) => r.json());

/**
 * One `0x` address is valid on every EVM network, so the picker leads with a
 * save-everywhere option; the per-network entries below it override one chain.
 */
const CHAIN_OPTIONS = WALLET_CHAINS.map((key) => ({
  key: key as string,
  label: walletChainLabel(key),
  hint: walletChainHint(key),
  evm: walletFamily(key) === "EVM",
}));
const CHAINS = [
  {
    key: EVM_FAMILY_KEY,
    label: `All EVM networks (${EVM_CHAINS.length})`,
    hint: "0x… — saved to every EVM network at once",
    evm: true,
  },
  ...CHAIN_OPTIONS,
];
const labelFor = (key: string) =>
  CHAIN_OPTIONS.find((c) => c.key === key)?.label ?? key;
const EVM_OPTIONS = CHAIN_OPTIONS.filter((c) => c.evm);
const OTHER_OPTIONS = CHAIN_OPTIONS.filter((c) => !c.evm);

interface Wallet {
  chain: string;
  address: string;
  updatedAt: string;
}

/** Add / update / remove payout wallets — web parity with /wallet register. */
export function WalletsEditor() {
  const { data, mutate } = useSWR<{ wallets: Wallet[] }>(
    "/api/me/wallets",
    fetcher,
  );
  const [chain, setChain] = useState<string>(EVM_FAMILY_KEY);
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
      setMsg(
        chain === EVM_FAMILY_KEY
          ? `Saved to all ${EVM_CHAINS.length} EVM networks.`
          : `${CHAINS.find((c) => c.key === chain)?.label} wallet saved.`,
      );
      mutate();
    } else {
      setMsg(body.error ?? "Couldn't save that address.");
    }
  }

  async function remove(label: string, chainKeys: string[]) {
    if (!confirm(`Remove your ${label} wallet?`)) return;
    await Promise.all(
      chainKeys.map((c) =>
        fetch(`/api/me/wallets?chain=${c}`, { method: "DELETE" }),
      ),
    );
    mutate();
  }

  // EVM rows that share an address collapse into one card — after a
  // save-everywhere that is all of them; a per-network override stands alone.
  const evmKeys = new Set<string>(EVM_CHAINS);
  const groups: {
    key: string;
    label: string;
    chainKeys: string[];
    address: string;
    updatedAt: string;
  }[] = [];
  const evmByAddress = new Map<string, Wallet[]>();
  for (const w of wallets) {
    if (!evmKeys.has(w.chain)) continue;
    const list = evmByAddress.get(w.address) ?? [];
    list.push(w);
    evmByAddress.set(w.address, list);
  }
  for (const [address, rows] of evmByAddress) {
    const chainKeys = rows.map((r) => r.chain);
    const label =
      chainKeys.length === EVM_CHAINS.length
        ? "All EVM networks"
        : chainKeys.length > 4
          ? `${chainKeys.length} EVM networks`
          : chainKeys.map((c) => labelFor(c)).join(", ");
    groups.push({
      key: `evm:${address}`,
      label,
      chainKeys: chainKeys.length === EVM_CHAINS.length ? [EVM_FAMILY_KEY] : chainKeys,
      address,
      updatedAt: rows.reduce(
        (latest, r) => (r.updatedAt > latest ? r.updatedAt : latest),
        rows[0]?.updatedAt ?? "",
      ),
    });
  }
  for (const w of wallets) {
    if (evmKeys.has(w.chain)) continue;
    groups.push({
      key: w.chain,
      label: labelFor(w.chain),
      chainKeys: [w.chain],
      address: w.address,
      updatedAt: w.updatedAt,
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="kos-card space-y-4 p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
            Add or update a wallet
          </div>
          <p className="mt-1 text-sm text-kos-muted">
            One registry powers Discord and the web. Update here and the bot
            sees it instantly.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
          <select
            className="kos-input sm:max-w-[160px]"
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          >
            <option value={EVM_FAMILY_KEY}>{CHAINS[0].label}</option>
            <optgroup label="EVM networks">
              {EVM_OPTIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other networks">
              {OTHER_OPTIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          </select>
          <input
            className="kos-input font-mono text-sm"
            placeholder={CHAINS.find((c) => c.key === chain)?.hint}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !address.trim()}
            className="kos-btn-primary whitespace-nowrap disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : chain === EVM_FAMILY_KEY
                ? "Save everywhere"
                : byChain.has(chain)
                  ? "Update"
                  : "Add wallet"}
          </button>
        </div>
        {msg ? <p className="text-sm text-kos-muted">{msg}</p> : null}
      </form>

      {!data ? (
        <Empty>Loading…</Empty>
      ) : wallets.length === 0 ? (
        <Empty>
          No wallets yet. Add one above — some raffles require it to enter.
        </Empty>
      ) : (
        <div className="grid gap-3">
          {groups.map((g) => (
            <div
              key={g.key}
              className="kos-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">{g.label}</div>
                <code className="break-all text-xs text-kos-muted">
                  {g.address}
                </code>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] text-kos-muted">
                  updated {new Date(g.updatedAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => remove(g.label, g.chainKeys)}
                  className="text-xs text-kos-muted hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-kos-muted/70">
        Also works in Discord with <code>/wallet register</code> — it's the same
        registry. Addresses are encrypted at rest and only shared with the
        community whose raffle you win.
      </p>
    </div>
  );
}
