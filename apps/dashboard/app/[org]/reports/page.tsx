"use client";

import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageTitle, Empty, StatusBadge } from "@/components/ui";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Report {
  id: number;
  projectName: string;
  title: string;
  spots: number;
  entryCount: number;
  winners: number;
  endedAt: string | null;
  verified: boolean;
  messageLink: string | null;
  hasProof: boolean;
}

export default function ReportsPage() {
  const { org } = useParams<{ org: string }>();
  const canExport = useCan(PERMISSIONS.REPORT_EXPORT);
  const canExportWallets = useCan(PERMISSIONS.WALLET_EXPORT);
  const { data } = useSWR<{ reports: Report[]; error?: string }>(`/api/${org}/reports`, fetcher);

  if (data?.error) {
    return (
      <>
        <PageTitle title="Reports" subtitle="Verifiable proof for completed raffles." />
        <Empty>You don't have permission to view reports.</Empty>
      </>
    );
  }
  const reports = data?.reports ?? [];

  return (
    <>
      <PageTitle title="Reports" subtitle="Verifiable proof for completed raffles." />

      {!data ? (
        <Empty>Loading…</Empty>
      ) : reports.length === 0 ? (
        <Empty>No completed raffles yet.</Empty>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="kos-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/${org}/raffles/${r.id}`} className="text-xs text-kos-muted hover:text-kos-fg">
                      #{r.id}
                    </Link>
                    <StatusBadge status="ENDED" />
                    {r.verified ? (
                      <span className="kos-badge border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90">
                        verifiable
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 font-medium">{r.projectName}</div>
                  <div className="text-sm text-kos-muted">{r.title}</div>
                  <div className="mt-1 text-xs text-kos-muted">
                    {r.winners} winners · {r.entryCount} entries · {r.spots} spots ·{" "}
                    {r.endedAt ? fmtDate(r.endedAt) : "—"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canExportWallets ? (
                    <a className="kos-btn" href={`/api/${org}/raffles/${r.id}/export-xlsx?mode=addresses`}>
                      Addresses
                    </a>
                  ) : null}
                  {canExport ? (
                    <a className="kos-btn" href={`/api/${org}/raffles/${r.id}/export?type=winners`}>
                      Winners CSV
                    </a>
                  ) : null}
                  {r.messageLink ? (
                    <a className="kos-btn" href={r.messageLink} target="_blank" rel="noreferrer">
                      Discord proof ↗
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
