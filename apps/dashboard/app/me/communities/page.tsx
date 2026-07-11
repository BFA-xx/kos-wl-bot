import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser, getValidAccessToken } from "@/lib/auth";
import { fetchUserGuildsResult, guildIconUrl } from "@/lib/discord-oauth";
import { xProfileUrl } from "@/lib/organization-social";
import { communityHasGuildMembership } from "@/lib/communities";
import { PageTitle, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Community = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  xHandle: string | null;
  guildConnections: { guildId: string }[];
};

/** Member-aware directory: Discord communities the member is in + all KOS tenants. */
export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const user = await getSessionUser();
  const orgs = await prisma.organization.findMany({
    where: { suspendedAt: null },
    orderBy: { name: "asc" },
    include: { guildConnections: { select: { guildId: true } } },
  });

  const guildIds = orgs.flatMap((org) =>
    org.guildConnections.map((connection) => connection.guildId),
  );
  const discordMemberships = user
    ? getValidAccessToken(user.id)
        .then((token) =>
          token
            ? fetchUserGuildsResult(token)
            : { ok: false as const, guilds: [] },
        )
        .catch(() => ({ ok: false as const, guilds: [] }))
    : Promise.resolve({ ok: false as const, guilds: [] });
  const [liveCounts, storedGuilds, discordResult] = await Promise.all([
    guildIds.length
      ? prisma.raffle.groupBy({
          by: ["guildId"],
          where: { guildId: { in: guildIds }, status: "LIVE" },
          _count: true,
        })
      : [],
    guildIds.length
      ? prisma.guild.findMany({
          where: { id: { in: guildIds } },
          select: { id: true, iconUrl: true },
        })
      : [],
    discordMemberships,
  ]);

  const liveByGuild = new Map(
    liveCounts.map((row) => [row.guildId, row._count]),
  );
  const storedIconByGuild = new Map(
    storedGuilds.map((guild) => [guild.id, guild.iconUrl]),
  );
  const discordGuildById = new Map(
    discordResult.guilds.map((guild) => [guild.id, guild]),
  );
  const memberGuildIds = new Set(discordResult.guilds.map((guild) => guild.id));
  const myCommunities = orgs.filter((org) =>
    communityHasGuildMembership(org.guildConnections, memberGuildIds),
  );
  const view = searchParams?.view === "all" ? "all" : "mine";
  const visible = view === "mine" ? myCommunities : orgs;

  const liveFor = (org: Community) =>
    org.guildConnections.reduce(
      (sum, connection) => sum + (liveByGuild.get(connection.guildId) ?? 0),
      0,
    );
  const logoFor = (org: Community) => {
    if (org.logoUrl) return org.logoUrl;
    for (const connection of org.guildConnections) {
      const discordGuild = discordGuildById.get(connection.guildId);
      const icon = discordGuild
        ? guildIconUrl(discordGuild)
        : storedIconByGuild.get(connection.guildId);
      if (icon) return icon;
    }
    return null;
  };

  return (
    <div data-testid="communities-directory">
      <PageTitle
        title="Communities"
        subtitle="Keep up with communities you belong to, or discover every community building with KOS."
        action={
          <Link href="/onboarding" className="kos-btn">
            Create your own
          </Link>
        }
      />

      <div
        data-testid="communities-metrics"
        className="mb-6 grid gap-3 sm:grid-cols-3"
      >
        <Metric
          label="Your communities"
          value={discordResult.ok ? myCommunities.length : "—"}
        />
        <Metric label="All communities" value={orgs.length} />
        <Metric
          label="Live raffles"
          value={liveCounts.reduce((sum, row) => sum + row._count, 0)}
          accent
        />
      </div>

      <div className="mb-6 flex max-w-xl rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
        <DirectoryTab
          href="/me/communities?view=mine"
          active={view === "mine"}
          label="Your communities"
          count={discordResult.ok ? myCommunities.length : undefined}
        />
        <DirectoryTab
          href="/me/communities?view=all"
          active={view === "all"}
          label="Discover all"
          count={orgs.length}
        />
      </div>

      {view === "mine" && !discordResult.ok ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-100">
          <div className="font-medium">
            Reconnect Discord to load your communities
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-100/70">
            Your community list uses Discord membership and never exposes your
            servers publicly.
          </p>
          <Link
            href="/api/auth/discord/login?next=%2Fme%2Fcommunities"
            className="kos-btn mt-3"
          >
            Reconnect Discord
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <Empty>
          {view === "mine"
            ? "None of your Discord communities are using KOS yet. Explore the directory to find more."
            : "No communities yet."}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((org) => (
            <CommunityCard
              key={org.id}
              community={org}
              logoUrl={logoFor(org)}
              live={liveFor(org)}
              joined={myCommunities.some(
                (memberOrg) => memberOrg.id === org.id,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryTab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`kos-focus flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors ${
        active ? "bg-white text-black" : "text-kos-muted hover:text-white"
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className={active ? "text-black/55" : "text-kos-muted/70"}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function CommunityCard({
  community,
  logoUrl,
  live,
  joined,
}: {
  community: Community;
  logoUrl: string | null;
  live: number;
  joined: boolean;
}) {
  return (
    <article
      data-testid="community-card"
      className="kos-card kos-card-hover group overflow-hidden"
    >
      <Link href={`/c/${community.slug}`} className="block">
        <div className="relative flex min-h-28 items-end overflow-hidden border-b border-white/[0.08] bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.18),transparent_55%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent)] p-4">
          {community.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={community.bannerUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-65 transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-[#111]/25 to-transparent" />
          <div className="relative flex w-full items-end justify-between gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.12] bg-[#111] text-xs font-black shadow-xl">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                community.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {joined ? (
                <span className="kos-badge border-blue-400/25 bg-blue-500/10 text-blue-200">
                  Joined
                </span>
              ) : null}
              <span
                data-testid="community-live-status"
                className={`kos-badge ${
                  live
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                    : "text-kos-muted"
                }`}
              >
                {live ? `${live} live` : "No live raffles"}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-white">
                {community.name}
              </h2>
              <p className="mt-0.5 truncate text-xs text-kos-muted">
                /{community.slug}
              </p>
            </div>
            <span className="text-kos-muted transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </div>
          <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-kos-muted/85">
            {community.description ||
              "Raffles, rewards, and community activity on KOS."}
          </p>
        </div>
      </Link>

      {community.xHandle ? (
        <div className="border-t border-white/[0.08] px-4 py-3">
          <a
            href={xProfileUrl(community.xHandle)}
            target="_blank"
            rel="noreferrer"
            className="kos-focus inline-flex items-center gap-2 rounded-lg text-xs text-kos-muted transition-colors hover:text-white"
          >
            <span className="font-semibold text-white">𝕏</span>@
            {community.xHandle}
          </a>
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <div
        className={`text-2xl font-semibold ${accent ? "text-emerald-300" : "text-white"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}
