import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { PageTitle, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHAIN_LABEL: Record<string, string> = {
  ETHEREUM: "Ethereum",
  BASE: "Base",
  SOLANA: "Solana",
  BITCOIN: "Bitcoin",
};

export default async function MeWalletsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me/wallets");

  const wallets = await prisma.walletProfile.findMany({
    where: { userId: user.id },
    orderBy: { chain: "asc" },
  });

  return (
    <>
      <PageTitle
        title="My wallets"
        subtitle="Payout addresses used when you win. Manage them with /wallet in Discord."
      />

      {wallets.length === 0 ? (
        <Empty>
          No wallets registered yet. Run <code>/wallet register</code> in any KOS Discord server.
        </Empty>
      ) : (
        <div className="space-y-2">
          {wallets.map((w) => (
            <div
              key={w.id}
              className="flex flex-col gap-1 rounded-xl border border-kos-border bg-kos-panel/50 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-semibold">{CHAIN_LABEL[w.chain] ?? w.chain}</div>
                <code className="break-all text-xs text-kos-muted">{decryptSecret(w.address)}</code>
              </div>
              <span className="shrink-0 text-[11px] text-kos-muted">
                updated {fmtDate(w.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-kos-muted/70">
        Some raffles require a registered wallet before you can enter. Your addresses are
        encrypted at rest and only shared with the community whose raffle you win.
      </p>
    </>
  );
}
