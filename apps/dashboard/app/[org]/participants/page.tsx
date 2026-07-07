"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { PageTitle, StatCard, Empty, TableShell } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  userId: string;
  username: string;
  enteredAt: string;
  flagged: boolean;
  flagReason: string | null;
  raffleId: number;
  project: string;
}

export default function ParticipantsPage() {
  const { org } = useParams<{ org: string }>();
  const [q, setQ] = useState("");
  const { data } = useSWR<{
    uniqueEntrants: number;
    participants: Row[];
    error?: string;
  }>(`/api/${org}/participants`, fetcher);

  const rows = data?.participants ?? [];
  const filtered = q
    ? rows.filter(
        (r) =>
          r.username.toLowerCase().includes(q.toLowerCase()) ||
          r.userId.includes(q),
      )
    : rows;

  return (
    <>
      <PageTitle
        title="Participants"
        subtitle="Everyone who entered your raffles."
        action={
          <input
            className="kos-input sm:max-w-[220px]"
            placeholder="Search user…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Unique entrants" value={data?.uniqueEntrants ?? "—"} />
        <StatCard label="Recent entries" value={rows.length} />
      </div>

      {data?.error ? (
        <Empty>You don't have permission to view participants.</Empty>
      ) : !data ? (
        <Empty>Loading…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No participants yet.</Empty>
      ) : (
        <TableShell>
          <table className="kos-table">
            <thead>
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Raffle</th>
                <th className="hidden px-4 py-3 md:table-cell">Entered</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.raffleId}-${r.userId}-${i}`}>
                  <td className="px-4 py-3">
                    {r.username}
                    {r.flagged ? (
                      <span
                        className="ml-2 text-xs text-amber-400"
                        title={r.flagReason ?? "flagged"}
                      >
                        ⚑
                      </span>
                    ) : null}
                    <div className="text-[11px] text-kos-muted">{r.userId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/${org}/raffles/${r.raffleId}`}
                      className="text-kos-muted hover:text-kos-fg"
                    >
                      #{r.raffleId} · {r.project}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-kos-muted md:table-cell">
                    {fmtDate(r.enteredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </>
  );
}
