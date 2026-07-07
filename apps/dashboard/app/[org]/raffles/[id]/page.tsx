import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AccessError, requireOrgAccess } from "@/lib/access";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { PageTitle, StatusBadge, StatCard } from "@/components/ui";
import { RaffleActions } from "@/components/RaffleActions";
import { RaffleEditButton } from "@/components/RaffleEditButton";
import { ParticipantsLive } from "@/components/ParticipantsLive";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RaffleDetailPage({
  params,
}: {
  params: { org: string; id: string };
}) {
  let access;
  try {
    access = await requireOrgAccess(params.org);
  } catch (err) {
    if (err instanceof AccessError) {
      if (err.status === 401) redirect("/login");
      redirect("/");
    }
    throw err;
  }
  const { guildIds, org, isOwner, permissions } = access;

  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const raffle = await prisma.raffle.findFirst({
    where: { id, guildId: { in: guildIds } },
    include: {
      eligibleRoles: true,
      RaffleTask: {
        where: { task: { active: true } },
        orderBy: { id: "asc" },
        select: {
          taskId: true,
          required: true,
          task: {
            select: {
              title: true,
              type: true,
              description: true,
              points: true,
            },
          },
        },
      },
      winners: { where: { replaced: false }, orderBy: { position: "asc" }, include: { wallet: true } },
      proof: true,
      _count: { select: { participants: true } },
    },
  });
  if (!raffle) notFound();

  const canEdit = hasPermission({ isOwner, permissions }, PERMISSIONS.RAFFLE_EDIT);
  const verificationTasks = canEdit
    ? await prisma.taskDefinition.findMany({
        where: { organizationId: org.id, active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, type: true },
      })
    : [];

  const req = (raffle.requirements ?? {}) as Record<string, unknown>;
  const socialTasks = getSocialTasks(req);
  const minAccountAgeDays = positiveNumber(req.minAccountAgeDays);
  const minServerAgeDays = positiveNumber(req.minServerAgeDays);
  const requiredRoleIds = stringList(req.requiredRoleIds);
  const hasReactionRequirement = Boolean(req.requiredReaction);
  const extraRequirementKeys = Object.keys(req).filter(
    (key) =>
      ![
        "tasks",
        "minAccountAgeDays",
        "minServerAgeDays",
        "requiredRoleIds",
        "requiredReaction",
      ].includes(key),
  );

  return (
    <>
      <div className="mb-2">
        <Link href={`/${params.org}/raffles`} className="text-sm text-kos-muted hover:text-kos-fg">
          ← All raffles
        </Link>
      </div>
      <PageTitle
        title={raffle.title}
        subtitle={`${raffle.projectName} · Raffle #${raffle.id}`}
        action={
          <div className="flex items-center gap-2">
            <RaffleEditButton
              raffle={{
                id: raffle.id,
                guildId: raffle.guildId,
                status: raffle.status,
                projectName: raffle.projectName,
                title: raffle.title,
                description: raffle.description,
                spots: raffle.spots,
                startAt: raffle.startAt.toISOString(),
                endAt: raffle.endAt.toISOString(),
                bannerUrl: raffle.bannerUrl,
                hideEntries: raffle.hideEntries,
                requireWallet: raffle.requireWallet,
                startPing: raffle.startPing,
                roleMatchMode: raffle.roleMatchMode,
                walletChains: raffle.walletChains,
                collectWallets: raffle.collectWallets,
                announceChannelId: raffle.announceChannelId,
                proofChannelId: raffle.proofChannelId,
                tasks:
                  ((raffle.requirements as { tasks?: { label: string; url?: string }[] } | null)?.tasks) ?? [],
                verificationTasks,
                verificationTaskIds: raffle.RaffleTask.map((rt) => rt.taskId),
                roles: raffle.eligibleRoles.map((r) => ({ roleId: r.roleId, roleName: r.roleName })),
              }}
            />
            <StatusBadge status={raffle.status} />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="WL Spots" value={raffle.spots} />
        <StatCard label="Entries" value={raffle._count.participants} />
        <StatCard label="Winners" value={raffle.winners.length} />
        <StatCard label="Role Mode" value={<span className="text-base">{raffle.roleMatchMode}</span>} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">Details</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Start" value={fmtDate(raffle.startAt)} />
            <Row label="End" value={fmtDate(raffle.endAt)} />
            <Row label="Drawn" value={fmtDate(raffle.drawnAt)} />
            <Row
              label="Eligible Roles"
              value={raffle.eligibleRoles.length ? raffle.eligibleRoles.map((r) => r.roleName).join(", ") : "Everyone"}
            />
            <Row label="Collect Wallets" value={raffle.collectWallets ? "Yes" : "No"} />
            <Row label="Wallet Chains" value={raffle.walletChains.join(", ") || "—"} />
            {raffle.drawSeedHash ? (
              <Row label="Draw Commitment" value={<code className="text-xs">{raffle.drawSeedHash.slice(0, 28)}…</code>} />
            ) : null}
          </dl>

          <div className="mt-4 border-t border-kos-border pt-3">
            <div className="mb-3 text-xs uppercase tracking-wide text-kos-muted">Entry Requirements</div>
            <div className="space-y-2">
              {raffle.requireWallet ? (
                <RequirementRow
                  tone="green"
                  title="Wallet required"
                  body={`Member must register one of: ${raffle.walletChains.join(", ") || "configured chains"}.`}
                />
              ) : null}
              {minAccountAgeDays ? (
                <RequirementRow
                  title="Discord account age"
                  body={`Account must be at least ${minAccountAgeDays} day${minAccountAgeDays === 1 ? "" : "s"} old.`}
                />
              ) : null}
              {minServerAgeDays ? (
                <RequirementRow
                  title="Server age"
                  body={`Member must be in the server for ${minServerAgeDays}+ day${minServerAgeDays === 1 ? "" : "s"}.`}
                />
              ) : null}
              {requiredRoleIds.length > 0 ? (
                <RequirementRow
                  title="Additional role gate"
                  body={`${requiredRoleIds.length} legacy role id${requiredRoleIds.length === 1 ? "" : "s"} required.`}
                />
              ) : null}
              {hasReactionRequirement ? (
                <RequirementRow
                  tone="amber"
                  title="Discord reaction required"
                  body="This gate is Discord-native, so members enter from Discord."
                />
              ) : null}
              {raffle.RaffleTask.map((rt) => (
                <RequirementRow
                  key={rt.taskId}
                  tone="green"
                  title={rt.task.title}
                  body={`${formatTaskType(rt.task.type)}${rt.required ? " · required" : ""}${rt.task.points > 0 ? ` · +${rt.task.points} pts` : ""}`}
                />
              ))}
              {socialTasks.map((task, i) => (
                <RequirementRow
                  key={`${task.label}-${i}`}
                  title={task.label}
                  body={task.url ? "Social/off-platform step with external link." : "Social/off-platform step."}
                  href={task.url}
                />
              ))}
              {extraRequirementKeys.length > 0 ? (
                <RequirementRow
                  tone="amber"
                  title="Additional legacy gates"
                  body={`${extraRequirementKeys.length} older requirement field${extraRequirementKeys.length === 1 ? "" : "s"} configured.`}
                />
              ) : null}
              {!raffle.requireWallet &&
              !minAccountAgeDays &&
              !minServerAgeDays &&
              requiredRoleIds.length === 0 &&
              !hasReactionRequirement &&
              raffle.RaffleTask.length === 0 &&
              socialTasks.length === 0 &&
              extraRequirementKeys.length === 0 ? (
                <div className="rounded-xl border border-dashed border-kos-border bg-kos-panel/50 p-3 text-sm text-kos-muted">
                  No extra entry requirements beyond the raffle's role and timing settings.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="kos-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-kos-muted">Winners</h3>
          {raffle.winners.length === 0 ? (
            <div className="rounded-xl border border-dashed border-kos-border bg-kos-panel/50 p-4 text-sm text-kos-muted">
              <div className="font-medium text-kos-fg">Winners pending</div>
              <p className="mt-1">The draw has not run yet. Winners and wallet status will appear here after the raffle ends.</p>
            </div>
          ) : (
            <ol className="space-y-1 text-sm">
              {raffle.winners.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span>
                    <span className="text-kos-muted">{w.position}.</span> {w.username}
                    {w.fromReroll ? <span className="ml-2 text-xs text-kos-muted">(reroll)</span> : null}
                  </span>
                  <span className="text-xs text-kos-muted">{w.wallet ? `${w.wallet.chain} ✓` : "no wallet"}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="mt-4">
        <ParticipantsLive raffleId={raffle.id} />
      </div>

      <div className="mt-4">
        <RaffleActions raffleId={raffle.id} status={raffle.status} />
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-kos-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function RequirementRow({
  title,
  body,
  href,
  tone = "neutral",
}: {
  title: string;
  body: string;
  href?: string;
  tone?: "neutral" | "green" | "amber";
}) {
  const dot =
    tone === "green"
      ? "bg-emerald-500/20 text-emerald-400"
      : tone === "amber"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-kos-panel text-kos-muted";

  return (
    <div className="flex items-start gap-3 rounded-xl border border-kos-border bg-kos-panel/50 p-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${dot}`}>
        ✓
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-kos-fg">{title}</div>
        <div className="mt-0.5 text-xs text-kos-muted">{body}</div>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs text-kos-muted underline-offset-2 hover:text-kos-fg hover:underline"
        >
          Open ↗
        </a>
      ) : null}
    </div>
  );
}

function getSocialTasks(req: Record<string, unknown>): { label: string; url?: string }[] {
  if (!Array.isArray(req.tasks)) return [];
  return req.tasks.flatMap((task) => {
    if (!task || typeof task !== "object") return [];
    const t = task as { label?: unknown; url?: unknown };
    if (typeof t.label !== "string" || !t.label.trim()) return [];
    return [{ label: t.label, url: typeof t.url === "string" && t.url.trim() ? t.url : undefined }];
  });
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function formatTaskType(type: string): string {
  return type
    .split("_")
    .map((part) => part.slice(0, 1) + part.slice(1).toLowerCase())
    .join(" ");
}
