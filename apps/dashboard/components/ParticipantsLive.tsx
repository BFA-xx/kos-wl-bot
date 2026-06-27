"use client";

import useSWR from "swr";
import { useState } from "react";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Participant {
  userId: string;
  username: string;
  enteredAt: string;
  flagged: boolean;
  flagReason: string | null;
}

interface Data {
  count: number;
  status: string | null;
  spots: number | null;
  participants: Participant[];
}

export function ParticipantsLive({ raffleId }: { raffleId: number }) {
  // Poll every 4s while a raffle is live so entries stream in.
  const { data } = useSWR<Data>(
    `/api/raffles/${raffleId}/participants`,
    fetcher,
    { refreshInterval: 4000 },
  );
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);

  const all = data?.participants ?? [];
  const filtered = q
    ? all.filter(
        (p) =>
          p.username.toLowerCase().includes(q.toLowerCase()) ||
          p.userId.includes(q),
      )
    : all;
  const live = data?.status === "LIVE";

  async function copyUsernames() {
    try {
      await navigator.clipboard.writeText(filtered.map((p) => p.username).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="kos-card p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-kos-grey">
          Participants
          <span className="ml-2 text-kos-white">{data?.count ?? "—"}</span>
          {data?.spots ? <span className="text-kos-grey"> / {data.spots} spots</span> : null}
          {live ? (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-kos-silver">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-kos-silver" />
              live
            </span>
          ) : null}
        </h3>
        <div className="flex gap-2">
          <input
            className="kos-input sm:max-w-[200px]"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="kos-btn whitespace-nowrap" onClick={copyUsernames}>
            {copied ? "Copied ✓" : "Copy usernames"}
          </button>
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-kos-grey">Loading…</p>
      ) : all.length === 0 ? (
        <p className="text-sm text-kos-grey">No entries yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="sticky top-0 bg-kos-card text-left text-xs uppercase tracking-wide text-kos-grey">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">User</th>
                <th className="px-2 py-2">Entered</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.userId} className="border-b border-kos-line/50">
                  <td className="px-2 py-2 text-kos-grey">{i + 1}</td>
                  <td className="px-2 py-2">
                    {p.username}
                    {p.flagged ? (
                      <span
                        className="ml-2 text-xs text-kos-grey"
                        title={p.flagReason ?? "flagged"}
                      >
                        ⚑
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-kos-grey">{fmtDate(p.enteredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
