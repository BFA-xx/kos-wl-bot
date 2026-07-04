"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { PageTitle, StatusBadge, Segmented, Empty } from "@/components/ui";
import { NewRaffleModal } from "@/components/NewRaffleModal";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Raffle {
  id: number;
  projectName: string;
  title: string;
  status: string;
  spots: number;
  entryCount: number;
  startAt: string;
  endAt: string;
}

const FILTERS = [
  { key: "", label: "All" },
  { key: "LIVE", label: "Live" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "ENDED", label: "Ended" },
];

export default function RafflesPage() {
  const { org } = useParams<{ org: string }>();
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const canCreate = useCan(PERMISSIONS.RAFFLE_CREATE);
  const { data } = useSWR<{ raffles: Raffle[] }>(
    `/api/${org}/raffles${status ? `?status=${status}` : ""}`,
    fetcher,
    { refreshInterval: 8000 },
  );
  const raffles = data?.raffles ?? [];

  return (
    <>
      {showNew ? <NewRaffleModal onClose={() => setShowNew(false)} /> : null}
      <PageTitle
        title="Raffles"
        subtitle="Every whitelist raffle across your connected servers."
        action={
          <>
            <Segmented options={FILTERS as any} value={status} onChange={setStatus} />
            {canCreate ? (
              <button className="kos-btn-primary" onClick={() => setShowNew(true)}>
                + New raffle
              </button>
            ) : null}
          </>
        }
      />

      {!data ? (
        <Empty>Loading…</Empty>
      ) : raffles.length === 0 ? (
        <Empty>No raffles yet. Run one from Discord with /raffle.</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-kos-border">
          <table className="w-full text-sm">
            <thead className="bg-kos-panel/60 text-left text-xs uppercase tracking-wide text-kos-muted">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Project / Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Entries</th>
                <th className="px-4 py-3 text-right">Spots</th>
                <th className="hidden px-4 py-3 md:table-cell">Ends</th>
              </tr>
            </thead>
            <tbody>
              {raffles.map((r) => (
                <tr key={r.id} className="border-t border-kos-border/60 hover:bg-kos-fg/[0.03]">
                  <td className="px-4 py-3 text-kos-muted">
                    <Link href={`/${org}/raffles/${r.id}`} className="hover:text-kos-fg">
                      #{r.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/${org}/raffles/${r.id}`} className="block">
                      <div className="font-medium">{r.projectName}</div>
                      <div className="text-xs text-kos-muted">{r.title}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{r.entryCount}</td>
                  <td className="px-4 py-3 text-right text-kos-muted">{r.spots}</td>
                  <td className="hidden px-4 py-3 text-kos-muted md:table-cell">{fmtDate(r.endAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
