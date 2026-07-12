import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import {
  Card,
  Empty,
  PageTitle,
  SectionTitle,
  StatCard,
  StatusBadge,
  TableShell,
} from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ParticipantDetailPage({
  params,
}: {
  params: { org: string; userId: string };
}) {
  let access;
  try {
    access = await requireOrgAccess(params.org, PERMISSIONS.PARTICIPANT_VIEW);
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) redirect("/login");
      if (err.status === 404) notFound();
      redirect(`/${params.org}/participants`);
    }
    throw err;
  }

  const { guildIds, org } = access;
  const canViewWallets = hasPermission(
    { isOwner: access.isOwner, permissions: access.permissions },
    PERMISSIONS.WALLET_VIEW,
  );
  const user = await prisma.user.findFirst({
    where: {
      id: params.userId,
      OR: [
        { participants: { some: { raffle: { guildId: { in: guildIds } } } } },
        { winners: { some: { raffle: { guildId: { in: guildIds } } } } },
        { pointsLedger: { some: { organizationId: org.id } } },
        {
          TaskCompletion: {
            some: { task: { organizationId: org.id } },
          },
        },
        { rewardRedemptions: { some: { organizationId: org.id } } },
      ],
    },
    select: {
      id: true,
      username: true,
      globalName: true,
      avatarUrl: true,
    },
  });
  if (!user) notFound();

  const [
    entries,
    wins,
    pointEvents,
    taskCompletions,
    redemptions,
    snapshot,
    walletProfiles,
    entryStats,
    activeWinCount,
    pointsBalanceAggregate,
    pointsEarnedAggregate,
    verifiedTaskCount,
    redemptionCount,
  ] = await Promise.all([
    prisma.participant.findMany({
      where: {
        userId: params.userId,
        raffle: { guildId: { in: guildIds } },
      },
      orderBy: { enteredAt: "desc" },
      take: 100,
      select: {
        id: true,
        enteredAt: true,
        weight: true,
        flagged: true,
        flagReason: true,
        raffle: {
          select: {
            id: true,
            projectName: true,
            title: true,
            status: true,
          },
        },
      },
    }),
    prisma.winner.findMany({
      where: {
        userId: params.userId,
        raffle: { guildId: { in: guildIds } },
      },
      orderBy: { selectedAt: "desc" },
      take: 50,
      select: {
        id: true,
        position: true,
        selectedAt: true,
        fromReroll: true,
        replaced: true,
        raffle: {
          select: { id: true, projectName: true, title: true },
        },
      },
    }),
    prisma.pointsLedger.findMany({
      where: { organizationId: org.id, userId: params.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        delta: true,
        reason: true,
        sourceType: true,
        createdAt: true,
      },
    }),
    prisma.taskCompletion.findMany({
      where: {
        userId: params.userId,
        task: { organizationId: org.id },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        verifiedAt: true,
        updatedAt: true,
        task: {
          select: { id: true, title: true, type: true, points: true },
        },
      },
    }),
    prisma.rewardRedemption.findMany({
      where: { organizationId: org.id, userId: params.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        cost: true,
        status: true,
        createdAt: true,
        reward: { select: { title: true } },
      },
    }),
    prisma.participant.findFirst({
      where: {
        userId: params.userId,
        raffle: { guildId: { in: guildIds } },
      },
      orderBy: { enteredAt: "desc" },
      select: { accountCreatedAt: true, joinedGuildAt: true },
    }),
    canViewWallets
      ? prisma.walletProfile.findMany({
          where: { userId: params.userId },
          orderBy: { updatedAt: "desc" },
          select: { chain: true, updatedAt: true },
        })
      : Promise.resolve([]),
    prisma.participant.aggregate({
      where: {
        userId: params.userId,
        raffle: { guildId: { in: guildIds } },
      },
      _count: true,
      _sum: { weight: true },
    }),
    prisma.winner.count({
      where: {
        userId: params.userId,
        replaced: false,
        raffle: { guildId: { in: guildIds } },
      },
    }),
    prisma.pointsLedger.aggregate({
      where: { organizationId: org.id, userId: params.userId },
      _sum: { delta: true },
    }),
    prisma.pointsLedger.aggregate({
      where: {
        organizationId: org.id,
        userId: params.userId,
        delta: { gt: 0 },
      },
      _sum: { delta: true },
    }),
    prisma.taskCompletion.count({
      where: {
        userId: params.userId,
        status: "VERIFIED",
        task: { organizationId: org.id },
      },
    }),
    prisma.rewardRedemption.count({
      where: { organizationId: org.id, userId: params.userId },
    }),
  ]);

  const displayName = user.globalName || user.username;
  const pointsBalance = pointsBalanceAggregate._sum.delta ?? 0;
  const pointsEarned = pointsEarnedAggregate._sum.delta ?? 0;

  return (
    <>
      <div className="mb-2">
        <Link
          href={`/${params.org}/participants`}
          className="text-sm text-kos-muted hover:text-kos-fg"
        >
          ← All participants
        </Link>
      </div>

      <PageTitle
        eyebrow="Member activity"
        title={displayName}
        subtitle={`Discord ID ${user.id} · Activity inside ${org.name}`}
        action={
          <div className="flex items-center gap-3">
            <MemberAvatar name={displayName} src={user.avatarUrl} />
            <a
              href={`https://discord.com/users/${user.id}`}
              target="_blank"
              rel="noreferrer"
              className="kos-btn"
            >
              Open Discord ↗
            </a>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard accent label="Points balance" value={pointsBalance} />
        <StatCard label="Raffle entries" value={entryStats._count} />
        <StatCard label="Active wins" value={activeWinCount} />
        <StatCard label="Verified tasks" value={verifiedTaskCount} />
        <StatCard label="Reward claims" value={redemptionCount} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <SectionTitle>Member overview</SectionTitle>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Detail label="Discord username" value={user.username} />
            <Detail label="Discord ID" value={user.id} mono />
            <Detail
              label="Discord account created"
              value={fmtDate(snapshot?.accountCreatedAt ?? null)}
            />
            <Detail
              label="Joined server"
              value={fmtDate(snapshot?.joinedGuildAt ?? null)}
            />
            <Detail
              label="Points earned"
              value={pointsEarned.toLocaleString()}
            />
            <Detail
              label="Entry weight total"
              value={(entryStats._sum.weight ?? 0).toLocaleString()}
            />
          </dl>

          <div className="mt-5 border-t border-kos-border pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-kos-muted">
              Registered wallet chains
            </div>
            {!canViewWallets ? (
              <p className="text-sm text-kos-muted">
                Wallet status requires the Wallet view permission.
              </p>
            ) : walletProfiles.length ? (
              <div className="flex flex-wrap gap-2">
                {walletProfiles.map((wallet) => (
                  <span
                    key={wallet.chain}
                    className="kos-badge border-emerald-400/25 text-emerald-300"
                    title={`Updated ${fmtDate(wallet.updatedAt)}`}
                  >
                    {wallet.chain}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-kos-muted">No wallet registered.</p>
            )}
            {canViewWallets ? (
              <p className="mt-2 text-xs leading-5 text-kos-muted">
                Addresses stay hidden here. Use the Wallets area for the full
                wallet record.
              </p>
            ) : null}
          </div>
        </Card>

        <div>
          <SectionTitle>Recent raffle activity</SectionTitle>
          {entries.length === 0 ? (
            <Empty>No raffle activity in this organization.</Empty>
          ) : (
            <TableShell>
              <table className="kos-table">
                <thead>
                  <tr>
                    <th>Raffle</th>
                    <th>Status</th>
                    <th className="text-right">Weight</th>
                    <th className="hidden md:table-cell">Entered</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <Link
                          href={`/${params.org}/raffles/${entry.raffle.id}`}
                          className="font-medium hover:text-blue-300"
                        >
                          {entry.raffle.projectName}
                        </Link>
                        <div className="text-xs text-kos-muted">
                          #{entry.raffle.id} · {entry.raffle.title}
                          {entry.flagged
                            ? ` · Flagged${entry.flagReason ? `: ${entry.flagReason}` : ""}`
                            : ""}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={entry.raffle.status} />
                      </td>
                      <td className="text-right font-medium">{entry.weight}</td>
                      <td className="hidden text-kos-muted md:table-cell">
                        {fmtDate(entry.enteredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ActivityCard title="Wins" empty="No raffle wins yet.">
          {wins.map((winner) => (
            <ActivityRow
              key={winner.id}
              title={`${winner.raffle.projectName} · #${winner.position}`}
              detail={`${winner.fromReroll ? "Reroll winner" : "Draw winner"}${winner.replaced ? " · Replaced" : ""}`}
              date={winner.selectedAt}
              tone={winner.replaced ? "muted" : "success"}
              href={`/${params.org}/raffles/${winner.raffle.id}`}
            />
          ))}
        </ActivityCard>

        <ActivityCard title="Task verification" empty="No task attempts yet.">
          {taskCompletions.map((completion) => (
            <ActivityRow
              key={completion.id}
              title={completion.task.title}
              detail={`${completion.status} · ${completion.task.type} · ${completion.task.points} pts`}
              date={completion.verifiedAt ?? completion.updatedAt}
              tone={completion.status === "VERIFIED" ? "success" : "muted"}
            />
          ))}
        </ActivityCard>

        <ActivityCard title="Points & rewards" empty="No points activity yet.">
          {pointEvents.slice(0, 8).map((event) => (
            <ActivityRow
              key={event.id}
              title={`${event.delta > 0 ? "+" : ""}${event.delta} points`}
              detail={`${event.reason} · ${event.sourceType}`}
              date={event.createdAt}
              tone={event.delta > 0 ? "success" : "muted"}
            />
          ))}
          {redemptions.slice(0, 5).map((redemption) => (
            <ActivityRow
              key={redemption.id}
              title={redemption.reward.title}
              detail={`${redemption.status} · ${redemption.cost} pts`}
              date={redemption.createdAt}
              tone={redemption.status === "FULFILLED" ? "success" : "muted"}
            />
          ))}
        </ActivityCard>
      </div>
    </>
  );
}

function MemberAvatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] text-sm font-bold">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-kos-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 break-all font-medium ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function ActivityCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children)
    ? children.flat().filter(Boolean)
    : [children];
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <Card className="space-y-2">
        {items.length ? (
          items
        ) : (
          <p className="text-sm text-kos-muted">{empty}</p>
        )}
      </Card>
    </div>
  );
}

function ActivityRow({
  title,
  detail,
  date,
  tone,
  href,
}: {
  title: string;
  detail: string;
  date: Date;
  tone: "success" | "muted";
  href?: string;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-medium">{title}</div>
      <div className="truncate text-xs text-kos-muted">{detail}</div>
    </div>
  );

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${tone === "success" ? "bg-emerald-400" : "bg-white/25"}`}
      />
      {href ? (
        <Link href={href} className="min-w-0 flex-1 hover:text-blue-300">
          {body}
        </Link>
      ) : (
        body
      )}
      <span className="shrink-0 text-[10px] text-kos-muted">
        {fmtDate(date)}
      </span>
    </div>
  );
}
