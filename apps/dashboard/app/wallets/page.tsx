import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { PageTitle, StatCard } from "@/components/ui";
import { WalletsManager } from "@/components/WalletsManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function WalletsPage() {
  const [total, byChain] = await Promise.all([
    prisma.walletProfile.count(),
    prisma.walletProfile.groupBy({ by: ["chain"], _count: { _all: true } }),
  ]);
  const uniqueUsers = await prisma.walletProfile
    .findMany({ select: { userId: true }, distinct: ["userId"] })
    .then((r) => r.length);

  return (
    <Shell>
      <PageTitle
        title="Wallet Registry"
        subtitle="Self-registered member wallets, reused across raffles."
        action={
          <a className="kos-btn" href="/api/wallets/export">
            Download CSV
          </a>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Registered Wallets" value={total} />
        <StatCard label="Unique Members" value={uniqueUsers} />
        <StatCard label="Chains In Use" value={byChain.length} />
      </div>

      <WalletsManager />
    </Shell>
  );
}
