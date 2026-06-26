"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  userId: string;
  username: string;
  chain: string;
  address: string;
}

export function WalletsManager() {
  const { data } = useSWR<{ rows: Row[] }>("/api/wallets", fetcher, {
    refreshInterval: 15000,
  });
  const [q, setQ] = useState("");
  const [chain, setChain] = useState("ALL");
  const [copied, setCopied] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const chains = useMemo(() => ["ALL", ...new Set(rows.map((r) => r.chain))], [rows]);

  const filtered = rows.filter(
    (r) =>
      (chain === "ALL" || r.chain === chain) &&
      (!q ||
        r.username.toLowerCase().includes(q.toLowerCase()) ||
        r.address.toLowerCase().includes(q.toLowerCase())),
  );

  async function copy(kind: "all" | "addresses" | "usernames") {
    let text = "";
    if (kind === "addresses") text = filtered.map((r) => r.address).join("\n");
    else if (kind === "usernames") text = filtered.map((r) => r.username).join("\n");
    else text = filtered.map((r) => `${r.username}\t${r.chain}\t${r.address}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied("error");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="kos-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <input
              className="kos-input sm:max-w-xs"
              placeholder="Search username or address…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="kos-input sm:max-w-[160px]"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
            >
              {chains.map((c) => (
                <option key={c} value={c}>
                  {c === "ALL" ? "All chains" : c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="kos-btn" onClick={() => copy("all")}>
              {copied === "all" ? "Copied ✓" : "Copy all"}
            </button>
            <button className="kos-btn" onClick={() => copy("addresses")}>
              {copied === "addresses" ? "Copied ✓" : "Addresses only"}
            </button>
            <button className="kos-btn" onClick={() => copy("usernames")}>
              {copied === "usernames" ? "Copied ✓" : "Usernames only"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-kos-grey">
          Showing {filtered.length} of {rows.length} registered wallet(s). Copy actions apply to the
          filtered list.
        </p>
      </div>

      <div className="kos-card overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-kos-line text-left text-xs uppercase tracking-wide text-kos-grey">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Chain</th>
              <th className="px-4 py-3">Address</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.userId}-${r.chain}`} className="border-b border-kos-line/60">
                <td className="px-4 py-3">{r.username}</td>
                <td className="px-4 py-3 text-kos-grey">{r.chain}</td>
                <td className="px-4 py-3">
                  <button
                    className="font-mono text-xs text-kos-silver hover:text-kos-white"
                    onClick={() => navigator.clipboard.writeText(r.address)}
                    title="Click to copy"
                  >
                    {r.address}
                  </button>
                </td>
              </tr>
            ))}
            {data && filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-kos-grey">
                  No wallets match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
