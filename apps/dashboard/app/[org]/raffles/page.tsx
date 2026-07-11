"use client";

import useSWR from "swr";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  PageTitle,
  StatusBadge,
  Segmented,
  Empty,
  TableShell,
} from "@/components/ui";
import { NewRaffleModal } from "@/components/NewRaffleModal";
import { RaffleQuickActions } from "@/components/RaffleQuickActions";
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
  return (
    <Suspense fallback={<Empty>Loading…</Empty>}>
      <RafflesInner />
    </Suspense>
  );
}

function RafflesInner() {
  const { org } = useParams<{ org: string }>();
  const searchParams = useSearchParams();
  const q = searchParams.get("q")?.trim() ?? "";
  const [status, setStatus] = useState("");
  const [showNew, setShowNew] = useState(false);
  const canCreate = useCan(PERMISSIONS.RAFFLE_CREATE);
  const canEdit = useCan(PERMISSIONS.RAFFLE_EDIT);
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/api/${org}/raffles${qs ? `?${qs}` : ""}`;
  }, [org, q, status]);
  const { data } = useSWR<{ raffles: Raffle[] }>(
    apiUrl,
    fetcher,
    { refreshInterval: 8000 },
  );
  const raffles = data?.raffles ?? [];

  return (
    <>
      {showNew ? <NewRaffleModal onClose={() => setShowNew(false)} /> : null}
      <PageTitle
        title="Raffles"
        subtitle={
          q
            ? `Search results for “${q}” across your connected servers.`
            : "Every whitelist raffle across your connected servers."
        }
        action={
          <>
            <Segmented
              options={FILTERS as any}
              value={status}
              onChange={setStatus}
            />
            {q ? (
              <Link href={`/${org}/raffles`} className="kos-btn">
                Clear search
              </Link>
            ) : null}
            {canCreate ? (
              <button
                className="kos-btn-primary"
                onClick={() => setShowNew(true)}
              >
                + New raffle
              </button>
            ) : null}
          </>
        }
      />

      {!data ? (
        <Empty>Loading…</Empty>
      ) : raffles.length === 0 ? (
        <Empty>
          {q
            ? "No raffles matched that search."
            : "No raffles yet. Run one from Discord with /raffle."}
        </Empty>
      ) : (
        <TableShell>
          <table className="kos-table">
            <thead>
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Project / Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Entries</th>
                <th className="px-4 py-3 text-right">Spots</th>
                <th className="hidden px-4 py-3 md:table-cell">Ends</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {raffles.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-kos-muted">
                    <Link
                      href={`/${org}/raffles/${r.id}`}
                      className="hover:text-kos-fg"
                    >
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
                  <td className="px-4 py-3 text-right font-medium">
                    {r.entryCount}
                  </td>
                  <td className="px-4 py-3 text-right text-kos-muted">
                    {r.spots}
                  </td>
                  <td className="hidden px-4 py-3 text-kos-muted md:table-cell">
                    {fmtDate(r.endAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end">
                      <RaffleQuickActions
                        raffleId={r.id}
                        canDuplicate={canCreate}
                        editHref={
                          canEdit &&
                          r.status !== "ENDED" &&
                          r.status !== "CANCELLED"
                            ? `/${org}/raffles/${r.id}?edit=1`
                            : undefined
                        }
                      />
                    </div>
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
