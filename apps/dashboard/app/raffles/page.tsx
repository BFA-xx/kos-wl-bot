import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { PageTitle, StatusBadge, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RafflesPage() {
  const raffles = await prisma.raffle.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <Shell>
      <PageTitle title="Raffles" subtitle={`${raffles.length} total`} />
      {raffles.length === 0 ? (
        <Empty>No raffles yet. Create one with /raffle create in Discord.</Empty>
      ) : (
        <div className="kos-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-kos-line text-left text-xs uppercase tracking-wide text-kos-grey">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Entries</th>
                <th className="px-4 py-3 text-right">Spots</th>
                <th className="px-4 py-3">Ends</th>
              </tr>
            </thead>
            <tbody>
              {raffles.map((r) => (
                <tr key={r.id} className="border-b border-kos-line/60 hover:bg-kos-panel">
                  <td className="px-4 py-3 text-kos-grey">#{r.id}</td>
                  <td className="px-4 py-3">
                    <Link href={`/raffles/${r.id}`} className="font-medium hover:text-kos-silver">
                      {r.title}
                    </Link>
                    <div className="text-xs text-kos-grey">{r.projectName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">{r.entryCount}</td>
                  <td className="px-4 py-3 text-right">{r.spots}</td>
                  <td className="px-4 py-3 text-kos-grey">{fmtDate(r.endAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
