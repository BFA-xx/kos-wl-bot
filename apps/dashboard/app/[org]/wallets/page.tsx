"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { PageTitle, StatCard, Empty } from "@/components/ui";
import { useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Row {
  raffleId: number;
  projectName: string;
  position: number;
  userId: string;
  username: string;
  chain: string | null;
  address: string | null;
  source: "submitted" | "profile" | "missing";
}

export default function WalletsPage() {
  const { org } = useParams<{ org: string }>();
  const canExport = useCan(PERMISSIONS.WALLET_EXPORT);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const { data } = useSWR<{ rows: Row[]; error?: string }>(`/api/${org}/wallets`, fetcher);

  const rows = data?.rows ?? [];
  const filtered = q
    ? rows.filter(
        (r) =>
          r.username.toLowerCase().includes(q.toLowerCase()) ||
          (r.address ?? "").toLowerCase().includes(q.toLowerCase()) ||
          r.projectName.toLowerCase().includes(q.toLowerCase()),
      )
    : rows;
  const withWallet = rows.filter((r) => r.address).length;

  async function copyAddresses() {
    try {
      await navigator.clipboard.writeText(
        filtered.filter((r) => r.address).map((r) => r.address).join("\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <PageTitle
        title="Wallets"
        subtitle="Winner wallet addresses across your raffles."
        action={
          <>
            <input
              className="kos-input sm:max-w-[200px]"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="kos-btn" onClick={copyAddresses}>
              {copied ? "Copied ✓" : "Copy addresses"}
            </button>
            {canExport ? (
              <a className="kos-btn-primary" href={`/api/${org}/wallets/export`}>
                Export CSV
              </a>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Winner rows" value={rows.length} />
        <StatCard accent label="With wallet" value={withWallet} />
        <StatCard label="Missing" value={rows.length - withWallet} />
      </div>

      {data?.error ? (
        <Empty>You don't have permission to view wallets.</Empty>
      ) : !data ? (
        <Empty>Loading…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No winner wallets yet.</Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-kos-border">
          <table className="w-full text-sm">
            <thead className="bg-kos-panel/60 text-left text-xs uppercase tracking-wide text-kos-muted">
              <tr>
                <th className="px-4 py-3">Winner</th>
                <th className="px-4 py-3">Raffle</th>
                <th className="px-4 py-3">Chain</th>
                <th className="px-4 py-3">Address</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.raffleId}-${r.userId}-${i}`} className="border-t border-kos-border/60">
                  <td className="px-4 py-3">
                    {r.username}
                    <span className="ml-1 text-xs text-kos-muted">#{r.position}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/${org}/raffles/${r.raffleId}`} className="text-kos-muted hover:text-kos-fg">
                      {r.projectName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-kos-muted">{r.chain ?? "—"}</td>
                  <td className="px-4 py-3">
                    {r.address ? (
                      <code className="text-xs">{r.address}</code>
                    ) : (
                      <span className="text-xs text-amber-400">missing</span>
                    )}
                    {r.source === "profile" ? (
                      <span className="ml-2 text-[10px] text-kos-muted">(profile)</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
