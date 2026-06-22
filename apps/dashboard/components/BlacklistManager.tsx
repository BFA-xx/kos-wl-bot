"use client";

import useSWR from "swr";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BlRow {
  id: number;
  guildId: string;
  userId: string;
  reason: string | null;
  createdAt: string;
}
interface GuildRow {
  id: string;
  name: string | null;
}

export function BlacklistManager() {
  const { data, mutate } = useSWR<{ rows: BlRow[]; guilds: GuildRow[] }>(
    "/api/blacklist",
    fetcher,
  );
  const [guildId, setGuildId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!guildId || !userId) return;
    setBusy(true);
    await fetch("/api/blacklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId, userId, reason }),
    });
    setBusy(false);
    setUserId("");
    setReason("");
    mutate();
  }

  async function remove(g: string, u: string) {
    if (!confirm("Remove from blacklist?")) return;
    await fetch(`/api/blacklist?guildId=${g}&userId=${u}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={add} className="kos-card p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            className="kos-input"
            placeholder="Guild ID"
            list="guilds"
            value={guildId}
            onChange={(e) => setGuildId(e.target.value)}
          />
          <datalist id="guilds">
            {data?.guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name ?? g.id}
              </option>
            ))}
          </datalist>
          <input
            className="kos-input"
            placeholder="Discord User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input
            className="kos-input"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="kos-btn" disabled={busy}>
            {busy ? "Adding…" : "Add to blacklist"}
          </button>
        </div>
      </form>

      <div className="kos-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-kos-line text-left text-xs uppercase tracking-wide text-kos-grey">
            <tr>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Guild</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-kos-line/60">
                <td className="px-4 py-3 font-mono text-xs">{r.userId}</td>
                <td className="px-4 py-3 text-kos-grey">{r.guildId}</td>
                <td className="px-4 py-3 text-kos-grey">{r.reason ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-xs text-kos-grey hover:text-kos-white"
                    onClick={() => remove(r.guildId, r.userId)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-kos-grey">
                  No blacklisted users.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
