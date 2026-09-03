import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { PageTitle, SectionTitle, StatCard } from "@/components/ui";
import { XConnectCard } from "@/components/XConnectCard";
import { TelegramConnectCard } from "@/components/TelegramConnectCard";
import { KosStandingCard } from "@/components/KosStandingCard";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MeProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  const [x, telegram, entryCount, winCount, orgCount] = await Promise.all([
    prisma.connectedAccount.findUnique({
      where: { userId_provider: { userId: user.id, provider: "X" } },
    }),
    prisma.connectedAccount.findUnique({
      where: { userId_provider: { userId: user.id, provider: "TELEGRAM" } },
    }),
    prisma.participant.count({ where: { userId: user.id } }),
    prisma.winner.count({ where: { userId: user.id, replaced: false } }),
    prisma.organizationMember.count({
      where: { userId: user.id, status: "ACTIVE" },
    }),
  ]);

  const meta = (x?.metadata ?? {}) as { avatar?: string | null };

  return (
    <>
      <PageTitle
        title="My profile"
        subtitle="Your KOS account — one identity across every community."
        action={
          <>
            <Link href="/me/raffles" className="kos-btn-primary">
              Enter raffles
            </Link>
            <Link href="/me/points" className="kos-btn">
              Earn points
            </Link>
            <Link href="/me/wallets" className="kos-btn">
              Wallets
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard accent label="Raffles entered" value={entryCount} />
        <StatCard label="Wins" value={winCount} />
        <StatCard label="Teams" value={orgCount} />
      </div>

      <SectionTitle>Connected accounts</SectionTitle>
      <div className="space-y-3">
        {/* Discord — always connected (it's the login). */}
        <div className="kos-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[#5865F2]/20 text-lg shadow-[0_18px_50px_-34px_rgba(88,101,242,0.9)]">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                "🎮"
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Discord</div>
              <div className="text-sm text-kos-muted">
                {user.globalName ?? user.username}
                <span className="ml-2 text-[11px] text-kos-muted/70">
                  @{user.username}
                </span>
              </div>
            </div>
            <span className="kos-badge border-emerald-400/30 text-emerald-500 dark:text-emerald-300/90">
              connected
            </span>
          </div>
        </div>

        <XConnectCard
          linked={
            x
              ? {
                  handle: x.handle ?? x.displayName ?? "connected account",
                  avatar: meta.avatar ?? null,
                  since: fmtDate(x.createdAt),
                }
              : null
          }
        />

        <TelegramConnectCard
          linked={
            telegram
              ? {
                  handle: telegram.handle,
                  displayName: telegram.displayName,
                  since: fmtDate(telegram.createdAt),
                }
              : null
          }
        />
      </div>

      <div className="mt-8">
        <KosStandingCard />
      </div>
    </>
  );
}
