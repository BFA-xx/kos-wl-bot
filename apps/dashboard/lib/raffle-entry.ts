import { prisma } from "@/lib/db";
import type { Raffle, RaffleRole, User } from "@prisma/client";
import {
  getLegacyRaffleTasks,
  LEGACY_TASK_VERIFY,
} from "@/lib/legacy-raffle-tasks";

/**
 * Web raffle entry — the same gates the Discord bot enforces, evaluated
 * server-side via the Discord REST API (bot token). Web parity rule: entering
 * from the site never bypasses a requirement, including being in the server.
 */

const DAY_MS = 86_400_000;
const DISCORD_EPOCH = 1420070400000n;

export type RaffleWithRoles = Raffle & { eligibleRoles: RaffleRole[] };

export interface Gate {
  key: string;
  label: string;
  ok: boolean;
  /** Why it's failing (user-facing). */
  reason?: string;
  /** Optional link that helps satisfy the gate. */
  url?: string;
}

export interface GateReport {
  gates: Gate[];
  canEnter: boolean;
  /** True when this raffle has a Discord-native requirement (reaction) the web can't check. */
  discordOnly: boolean;
}

/** Discord account creation date from the user id snowflake. */
export function snowflakeDate(id: string): Date | null {
  try {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
  } catch {
    return null;
  }
}

export interface RestMember {
  roles: string[];
  joined_at: string | null;
}

/** Fetch the user's membership in a guild via the bot token. */
export async function fetchGuildMember(
  guildId: string,
  userId: string,
): Promise<RestMember | "not_member" | "unavailable"> {
  const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!botToken) return "unavailable";
  const res = await fetch(`https://discord.com/api/guilds/${guildId}/members/${userId}`, {
    headers: { authorization: `Bot ${botToken}` },
    cache: "no-store",
  });
  if (res.status === 404) return "not_member";
  if (!res.ok) return "unavailable";
  const m = (await res.json()) as { roles?: string[]; joined_at?: string };
  return { roles: m.roles ?? [], joined_at: m.joined_at ?? null };
}

interface Requirements {
  minAccountAgeDays?: number;
  minServerAgeDays?: number;
  requiredRoleIds?: string[];
  requiredReaction?: unknown;
}

/**
 * Evaluate every entry gate for `user` on `raffle`. Returns a per-gate report
 * the raffle page renders as a checklist, plus the overall verdict.
 */
export async function evaluateWebGates(
  user: User,
  raffle: RaffleWithRoles,
): Promise<GateReport> {
  const gates: Gate[] = [];
  const req = (raffle.requirements ?? {}) as Requirements;
  let discordOnly = false;

  // 1. Blacklist (hard block, not shown as a checklist item unless it hits).
  const black = await prisma.blacklist.findUnique({
    where: { guildId_userId: { guildId: raffle.guildId, userId: user.id } },
  });
  if (black) {
    return {
      gates: [{ key: "blacklist", label: "Account standing", ok: false, reason: "You are blacklisted from raffles in this server." }],
      canEnter: false,
      discordOnly: false,
    };
  }

  // 2. Server membership (+ everything that needs the member object).
  const guild = await prisma.guild.findUnique({
    where: { id: raffle.guildId },
    select: { name: true },
  });
  const guildName = guild?.name ?? "the community's Discord server";
  const member = await fetchGuildMember(raffle.guildId, user.id);

  if (member === "unavailable") {
    gates.push({
      key: "member",
      label: `Member of ${guildName}`,
      ok: false,
      reason: "Couldn't check Discord right now — try again in a minute, or enter in Discord.",
    });
    return { gates, canEnter: false, discordOnly };
  }
  if (member === "not_member") {
    gates.push({
      key: "member",
      label: `Member of ${guildName}`,
      ok: false,
      reason: `Join ${guildName} on Discord first.`,
    });
    return { gates, canEnter: false, discordOnly };
  }
  gates.push({ key: "member", label: `Member of ${guildName}`, ok: true });

  // 3. Eligible roles (ANY/ALL) — same semantics as the bot.
  if (raffle.eligibleRoles.length > 0) {
    const names = raffle.eligibleRoles.map((r) => r.roleName).join(", ");
    const owned = raffle.eligibleRoles.filter((r) => member.roles.includes(r.roleId));
    const ok =
      raffle.roleMatchMode === "ALL"
        ? owned.length === raffle.eligibleRoles.length
        : owned.length > 0;
    gates.push({
      key: "roles",
      label: raffle.roleMatchMode === "ALL" ? `Hold all roles: ${names}` : `Hold a role: ${names}`,
      ok,
      reason: ok ? undefined : `You need ${raffle.roleMatchMode === "ALL" ? "all of" : "one of"}: ${names}.`,
    });
  }

  // 4. Extra required roles from requirements.
  if (req.requiredRoleIds?.length) {
    const ok = req.requiredRoleIds.every((rid) => member.roles.includes(rid));
    gates.push({
      key: "required-roles",
      label: "Additional required roles",
      ok,
      reason: ok ? undefined : "You are missing one or more required roles.",
    });
  }

  // 5. Account / server age.
  if (req.minAccountAgeDays && req.minAccountAgeDays > 0) {
    const created = snowflakeDate(user.id);
    const ok = created !== null && Date.now() - created.getTime() >= req.minAccountAgeDays * DAY_MS;
    gates.push({
      key: "account-age",
      label: `Discord account ≥ ${req.minAccountAgeDays} days old`,
      ok,
      reason: ok ? undefined : `Your account must be at least ${req.minAccountAgeDays} days old.`,
    });
  }
  if (req.minServerAgeDays && req.minServerAgeDays > 0) {
    const joined = member.joined_at ? new Date(member.joined_at).getTime() : null;
    const ok = joined !== null && Date.now() - joined >= req.minServerAgeDays * DAY_MS;
    gates.push({
      key: "server-age",
      label: `In the server ≥ ${req.minServerAgeDays} days`,
      ok,
      reason: ok ? undefined : `You must have been in the server for ${req.minServerAgeDays}+ days.`,
    });
  }

  // 6. Reaction requirements are Discord-native — punt to Discord.
  if (req.requiredReaction) {
    discordOnly = true;
    gates.push({
      key: "reaction",
      label: "React to the announcement (Discord only)",
      ok: false,
      reason: "This raffle checks a message reaction — enter it from Discord.",
    });
  }

  // 7. Wallet gate.
  if (raffle.requireWallet && raffle.walletChains.length > 0) {
    const have = await prisma.walletProfile.count({
      where: { userId: user.id, chain: { in: raffle.walletChains } },
    });
    const ok = have > 0;
    gates.push({
      key: "wallet",
      label: `Registered ${raffle.walletChains.join(" / ")} wallet`,
      ok,
      reason: ok ? undefined : "Add a wallet on the Wallets page first.",
      url: "/me/wallets",
    });
  }

  // 8. Task Engine gate — every required task VERIFIED.
  const raffleTasks = await prisma.raffleTask.findMany({
    where: { raffleId: raffle.id, required: true },
    include: { task: { select: { id: true, title: true, active: true } } },
  });
  if (raffleTasks.length > 0) {
    const completions = await prisma.taskCompletion.findMany({
      where: { userId: user.id, taskId: { in: raffleTasks.map((t) => t.taskId) }, status: "VERIFIED" },
      select: { taskId: true },
    });
    const done = new Set(completions.map((c) => c.taskId));
    for (const rt of raffleTasks) {
      if (!rt.task.active) continue;
      const ok = done.has(rt.taskId);
      gates.push({
        key: `task-${rt.taskId}`,
        label: rt.task.title,
        ok,
        reason: ok ? undefined : "Complete and verify this task.",
        url: `/me/tasks?raffle=${raffle.id}`,
      });
    }
  }

  // 9. Legacy raffle social/link steps — click + attest, no paid X API.
  const legacyTasks = getLegacyRaffleTasks(raffle.id, raffle.requirements);
  if (legacyTasks.length > 0) {
    const logs = await prisma.log.findMany({
      where: {
        raffleId: raffle.id,
        actorId: user.id,
        action: LEGACY_TASK_VERIFY,
      },
      select: { metadata: true },
    });
    const done = new Set(
      logs.flatMap((log) => {
        const key = ((log.metadata ?? {}) as { taskKey?: unknown }).taskKey;
        return typeof key === "string" ? [key] : [];
      }),
    );
    for (const task of legacyTasks) {
      const ok = done.has(task.key);
      gates.push({
        key: `legacy-task-${task.key}`,
        label: task.label,
        ok,
        reason: ok ? undefined : "Open and verify this raffle step.",
        url: `/me/tasks?raffle=${raffle.id}`,
      });
    }
  }

  return { gates, canEnter: gates.every((g) => g.ok) && !discordOnly, discordOnly };
}

/** Record a web entry (mirrors the bot's transaction + audit log). */
export async function recordWebEntry(
  user: User,
  raffle: RaffleWithRoles,
  member: RestMember,
): Promise<number> {
  const entryCount = await prisma.$transaction(async (tx) => {
    await tx.participant.create({
      data: {
        raffleId: raffle.id,
        userId: user.id,
        username: user.username,
        accountCreatedAt: snowflakeDate(user.id),
        joinedGuildAt: member.joined_at ? new Date(member.joined_at) : null,
      },
    });
    const updated = await tx.raffle.update({
      where: { id: raffle.id },
      data: { entryCount: { increment: 1 } },
      select: { entryCount: true },
    });
    return updated.entryCount;
  });

  await prisma.log
    .create({
      data: {
        guildId: raffle.guildId,
        raffleId: raffle.id,
        actorId: user.id,
        category: "ENTRY",
        action: "ENTRY_ADD",
        message: `${user.username} entered raffle #${raffle.id} via the website`,
      },
    })
    .catch(() => undefined);

  return entryCount;
}
