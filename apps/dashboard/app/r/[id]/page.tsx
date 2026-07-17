import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryPanel } from "@/components/EntryPanel";
import { PublicThemeBridge } from "@/components/PublicThemeBridge";
import { RaffleCountdown } from "@/components/RaffleCountdown";
import { StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { sanitizeHttpUrl } from "@/lib/raffle-input";
import { xProfileUrl } from "@/lib/organization-social";
import {
  canonicalRaffleBannerUrl,
  inferRaffleKind,
  parsePublicRaffleId,
  publicRafflePath,
  publicRaffleUrl,
} from "@/lib/raffle-share";
import { getPublicRaffle } from "@/lib/public-raffle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const id = parsePublicRaffleId(params.id);
  const data = id ? await getPublicRaffle(id) : null;
  if (!data) return { title: "Raffle not found · KOS" };

  const { raffle, organization } = data;
  const title = `${raffle.projectName} · ${raffle.title}`;
  const description =
    raffle.description?.trim().slice(0, 200) ||
    `Join ${organization.name}'s ${raffle.projectName} raffle on KOS.`;
  const url = publicRaffleUrl(raffle.id);
  const bannerUrl = canonicalRaffleBannerUrl(raffle.id, raffle.bannerUrl);

  return {
    title: `${title} · KOS Raffles`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "KOS Raffles",
      title,
      description,
      ...(bannerUrl
        ? {
            images: [
              { url: bannerUrl, alt: `${raffle.projectName} raffle banner` },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(bannerUrl ? { images: [bannerUrl] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export default async function ShareableRafflePage({
  params,
}: {
  params: { id: string };
}) {
  const id = parsePublicRaffleId(params.id);
  const data = id ? await getPublicRaffle(id) : null;
  if (!data) notFound();

  const { raffle, organization } = data;
  const requirements = (raffle.requirements ?? {}) as Record<string, unknown>;
  const legacyTasks = getLegacyTasks(requirements);
  const verificationTasks = raffle.RaffleTask.map((item) => ({
    key: item.task.id,
    label: item.task.title,
    description: item.task.description || formatTaskType(item.task.type),
    url: taskConfigUrl(item.task.config),
    required: item.required,
  }));
  const rules = getRules(requirements, {
    requireWallet: raffle.requireWallet,
    weighted: raffle.useRoleWeights,
  });
  const kind = inferRaffleKind(raffle.title);
  const bannerUrl = canonicalRaffleBannerUrl(raffle.id, raffle.bannerUrl);
  const projectUrl = sanitizeHttpUrl(raffle.externalUrl);
  const logoUrl =
    sanitizeHttpUrl(organization.logoUrl) ||
    sanitizeHttpUrl(raffle.guild.iconUrl);

  return (
    <main className="kos-public-dark dark min-h-dvh overflow-hidden bg-[#0A0A0A] text-white [color-scheme:dark]">
      <PublicThemeBridge />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.14),transparent_38%),radial-gradient(circle_at_82%_0%,rgba(139,92,246,0.12),transparent_34%)]" />

      <div className="relative mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:py-10">
        <header className="mb-5 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="kos-focus inline-flex items-center gap-2 rounded-xl text-sm font-semibold tracking-tight text-white"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.10] bg-white/[0.06] text-[11px] font-black shadow-lg">
              KOS
            </span>
            Raffles
          </Link>
          <span className="hidden text-xs text-kos-muted sm:block">
            Fair, verifiable community drops
          </span>
        </header>

        <section className="kos-fade overflow-hidden rounded-[2rem] border border-white/[0.09] bg-[#111]/90 shadow-[0_30px_120px_-55px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
          {bannerUrl ? (
            <div className="h-40 overflow-hidden border-b border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.16),transparent_50%),rgba(255,255,255,0.02)] sm:h-56 lg:h-72">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bannerUrl}
                alt={`${raffle.projectName} raffle banner`}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-32 border-b border-white/[0.08] bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(139,92,246,0.12),transparent)] sm:h-44" />
          )}

          <div className="p-5 sm:p-7 lg:p-8">
            <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={raffle.status} />
                  {kind ? (
                    <span className="kos-badge border-blue-400/25 bg-blue-500/10 text-blue-200">
                      {kind}
                    </span>
                  ) : null}
                  <span className="kos-badge text-kos-muted">
                    Raffle #{raffle.id}
                  </span>
                  {raffle.useRoleWeights ? (
                    <span className="kos-badge border-violet-400/25 bg-violet-500/10 text-violet-200">
                      Weighted draw
                    </span>
                  ) : null}
                </div>

                <h1 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
                  {raffle.projectName}
                </h1>
                <p className="mt-2 text-base text-kos-muted sm:text-xl">
                  {raffle.title}
                </p>
                {raffle.description ? (
                  <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-zinc-400 sm:text-base">
                    {raffle.description}
                  </p>
                ) : null}
                {projectUrl ? (
                  <a
                    href={projectUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="kos-btn kos-focus mt-5"
                  >
                    Visit project ↗
                  </a>
                ) : null}
              </div>

              <aside className="rounded-3xl border border-white/[0.09] bg-white/[0.035] p-4 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] text-xs font-bold">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={`${organization.name} logo`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      organization.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-kos-muted">
                      Hosted by
                    </div>
                    <div className="truncate text-sm font-semibold text-white">
                      {organization.name}
                    </div>
                    <div className="truncate text-xs text-kos-muted">
                      {raffle.guild.name || "Discord community"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 border-t border-white/[0.08] pt-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-kos-muted">
                    {raffle.status === "UPCOMING"
                      ? "Opens in"
                      : "Time remaining"}
                  </div>
                  <div className="mt-1 font-mono text-xl font-semibold tracking-tight text-white">
                    <RaffleCountdown
                      status={raffle.status}
                      startAt={raffle.startAt.toISOString()}
                      endAt={raffle.endAt.toISOString()}
                    />
                  </div>
                </div>
                {organization.xHandle ? (
                  <a
                    href={xProfileUrl(organization.xHandle)}
                    target="_blank"
                    rel="noreferrer"
                    className="kos-focus mt-4 inline-flex items-center gap-2 rounded-xl text-sm text-kos-muted transition-colors hover:text-white"
                  >
                    <span className="font-semibold text-white">𝕏</span>@
                    {organization.xHandle}
                  </a>
                ) : null}
              </aside>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <Metric label="Spots" value={raffle.spots} />
              <Metric
                label="Entries"
                value={raffle.hideEntries ? "Private" : raffle.entryCount}
              />
              <Metric label="Opens" value={fmtDate(raffle.startAt)} small />
              <Metric label="Ends" value={fmtDate(raffle.endAt)} small />
            </div>
          </div>
        </section>

        <div className="relative mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="space-y-4">
            <section className="kos-card p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
                    Eligibility
                  </div>
                  <h2 className="mt-1 text-lg font-semibold">
                    Required Discord roles
                  </h2>
                </div>
                <span className="kos-badge text-kos-muted">
                  {raffle.roleMatchMode === "ALL"
                    ? "All required"
                    : "Any qualifies"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {raffle.eligibleRoles.length ? (
                  raffle.eligibleRoles.map((role) => (
                    <span
                      key={role.id}
                      className="rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-sm text-zinc-200"
                    >
                      {role.roleName}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-kos-muted">
                    Open to every member of{" "}
                    {raffle.guild.name || organization.name}.
                  </span>
                )}
              </div>
            </section>

            {legacyTasks.length || verificationTasks.length ? (
              <section className="kos-card p-5 sm:p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
                  Steps to qualify
                </div>
                <h2 className="mt-1 text-lg font-semibold">
                  Complete before joining
                </h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[...legacyTasks, ...verificationTasks].map((task, index) => (
                    <div
                      key={task.key}
                      className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/12 text-xs font-semibold text-blue-200">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">
                          {task.label}
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-kos-muted">
                          {task.description}
                          {task.required ? " · Required" : ""}
                        </div>
                      </div>
                      {task.url ? (
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noreferrer"
                          className="kos-focus shrink-0 rounded-lg px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/10"
                        >
                          Open ↗
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {raffle.status === "ENDED" && raffle.winners.length ? (
              <section className="kos-card p-5 sm:p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
                  Results
                </div>
                <h2 className="mt-1 text-lg font-semibold">Winners</h2>
                <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                  {raffle.winners.map((winner) => (
                    <li
                      key={winner.id}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-sm"
                    >
                      <span className="mr-2 text-kos-muted">
                        #{winner.position}
                      </span>
                      {winner.username}
                    </li>
                  ))}
                </ol>
                {raffle.drawSeedHash ? (
                  <p className="mt-4 break-all text-[11px] leading-5 text-kos-muted">
                    Verifiable draw commitment · {raffle.drawSeedHash}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>

          <div className="space-y-4 lg:sticky lg:top-6">
            <EntryPanel
              raffleId={raffle.id}
              loginHref={`/api/auth/discord/login?next=${encodeURIComponent(publicRafflePath(raffle.id))}`}
            />
            <section className="kos-card p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-kos-muted">
                Rules
              </div>
              <ul className="mt-3 space-y-2.5 text-sm leading-6 text-zinc-400">
                {rules.map((rule) => (
                  <li key={rule} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <footer className="relative mt-8 pb-4 text-center text-xs text-kos-muted">
          Hosted with KOS · Verifiable raffles for Web3 communities
        </footer>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:p-4">
      <div
        className={`${small ? "text-xs sm:text-sm" : "text-xl sm:text-2xl"} truncate font-semibold text-white`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-kos-muted">
        {label}
      </div>
    </div>
  );
}

function getLegacyTasks(requirements: Record<string, unknown>) {
  if (!Array.isArray(requirements.tasks)) return [];
  return requirements.tasks.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const task = item as { label?: unknown; url?: unknown };
    const label = typeof task.label === "string" ? task.label.trim() : "";
    if (!label) return [];
    return [
      {
        key: `legacy-${index}-${label}`,
        label,
        description:
          "Open the link, complete the step, then verify when joining.",
        url: sanitizeHttpUrl(task.url) || undefined,
        required: true,
      },
    ];
  });
}

function taskConfigUrl(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const value = config as Record<string, unknown>;
  for (const key of ["url", "tweetUrl", "inviteUrl"]) {
    const url = sanitizeHttpUrl(value[key]);
    if (url) return url;
  }
  return undefined;
}

function getRules(
  requirements: Record<string, unknown>,
  options: { requireWallet: boolean; weighted: boolean },
): string[] {
  const configured = requirements.rules;
  const custom = Array.isArray(configured)
    ? configured.filter(
        (rule): rule is string =>
          typeof rule === "string" && Boolean(rule.trim()),
      )
    : typeof configured === "string" && configured.trim()
      ? configured
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean)
      : [];
  if (custom.length) return custom.slice(0, 12);

  return [
    "One entry per Discord account. Duplicate entries are blocked.",
    "You must remain eligible until the raffle closes.",
    ...(options.requireWallet
      ? ["Register a supported wallet before joining."]
      : []),
    ...(options.weighted
      ? ["Configured Discord roles may increase draw weight."]
      : ["Every eligible entry receives the same draw weight."]),
    "Winners are selected by KOS's verifiable draw engine.",
  ];
}

function formatTaskType(type: string): string {
  return type
    .split("_")
    .map((part) => part.slice(0, 1) + part.slice(1).toLowerCase())
    .join(" ");
}
