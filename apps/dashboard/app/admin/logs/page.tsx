import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/admin-guard";
import { PageTitle, Card, SectionTitle } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLogsPage() {
  await guardAdmin();

  const [audit, botLogs] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { organization: { select: { name: true, slug: true } } },
    }),
    prisma.log.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  return (
    <>
      <PageTitle title="Logs" subtitle="Platform audit trail and bot activity." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Organization audit log</SectionTitle>
          <div className="max-h-[520px] space-y-1.5 overflow-y-auto">
            {audit.length === 0 ? (
              <p className="text-sm text-kos-muted">No audit entries yet.</p>
            ) : (
              audit.map((a) => (
                <div key={a.id} className="rounded-lg border border-kos-border/60 bg-kos-panel/40 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.action}</span>
                    <span className="text-kos-muted">{fmtDate(a.createdAt)}</span>
                  </div>
                  <div className="text-kos-muted">
                    {a.organization.name} · actor {a.actorId ?? "system"}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle>Bot activity</SectionTitle>
          <div className="max-h-[520px] space-y-1.5 overflow-y-auto">
            {botLogs.length === 0 ? (
              <p className="text-sm text-kos-muted">No bot logs yet.</p>
            ) : (
              botLogs.map((l) => (
                <div key={l.id} className="rounded-lg border border-kos-border/60 bg-kos-panel/40 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{l.action}</span>
                    <span className="text-kos-muted">{fmtDate(l.createdAt)}</span>
                  </div>
                  <div className="truncate text-kos-muted">{l.message}</div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
