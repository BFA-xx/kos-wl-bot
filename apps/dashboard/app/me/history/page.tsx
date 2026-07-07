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
      include: {
        raffle: { select: { projectName: true, title: true, status: true } },
      },
    }),
  ]);

  return (
    <>
      <PageTitle
        title="My history"
        subtitle="Everything you've entered and won."
      />

      <div className="mb-6">
        <SectionTitle>Wins 🏆</SectionTitle>
        {wins.length === 0 ? (
          <Empty>No wins yet — keep entering!</Empty>
        ) : (
          <div className="grid gap-3">
            {wins.map((w) => (
              <div
                key={w.id}
                className="kos-card flex flex-col gap-3 border-emerald-400/20 bg-emerald-400/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {w.raffle.projectName}
                  </div>
                  <div className="text-xs text-kos-muted">
                    {w.raffle.title} · position #{w.position}
                    {w.wallet ? ` · wallet submitted (${w.wallet.chain})` : ""}
                  </div>
                </div>
                <span className="text-[11px] text-kos-muted">
                  {fmtDate(w.selectedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionTitle>Entries</SectionTitle>
      {entries.length === 0 ? (
        <Empty>You haven't entered any raffles yet.</Empty>
      ) : (
        <div className="grid gap-3">
          {entries.map((e) => (
            <div
              key={e.id}
              className="kos-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {e.raffle.projectName}
                </div>
                <div className="truncate text-xs text-kos-muted">
                  {e.raffle.title}
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-3">
                <StatusBadge status={e.raffle.status} />
                <span className="text-[11px] text-kos-muted">
                  {fmtDate(e.enteredAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
