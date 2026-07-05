import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { PageTitle, SectionTitle, Empty, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MeHistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me/history");

  const [wins, entries] = await Promise.all([
    prisma.winner.findMany({
      where: { userId: user.id, replaced: false },
      orderBy: { selectedAt: "desc" },
      take: 50,
      include: {
        raffle: { select: { projectName: true, title: true } },
        wallet: { select: { chain: true } },
      },
    }),
    prisma.participant.findMany({
      where: { userId: user.id },
      orderBy: { enteredAt: "desc" },
      take: 100,
      include: { raffle: { select: { projectName: true, title: true, status: true } } },
    }),
  ]);

  return (
    <>
      <PageTitle title="My history" subtitle="Everything you've entered and won." />

      <SectionTitle>Wins 🏆</SectionTitle>
      {wins.length === 0 ? (
        <Empty>No wins yet — keep entering!</Empty>
      ) : (
        <div className="mb-6 space-y-2">
          {wins.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4"
            >
              <div>
                <div className="text-sm font-semibold">{w.raffle.projectName}</div>
                <div className="text-xs text-kos-muted">
                  {w.raffle.title} · position #{w.position}
                  {w.wallet ? ` · wallet submitted (${w.wallet.chain})` : ""}
                </div>
              </div>
              <span className="text-[11px] text-kos-muted">{fmtDate(w.selectedAt)}</span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle>Entries</SectionTitle>
      {entries.length === 0 ? (
        <Empty>You haven't entered any raffles yet.</Empty>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between rounded-xl border border-kos-border bg-kos-panel/50 p-4"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.raffle.projectName}</div>
                <div className="truncate text-xs text-kos-muted">{e.raffle.title}</div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-3">
                <StatusBadge status={e.raffle.status} />
                <span className="text-[11px] text-kos-muted">{fmtDate(e.enteredAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
