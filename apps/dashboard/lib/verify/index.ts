import { prisma } from "@/lib/db";
import type { TaskDefinition, TaskType, CompletionStatus } from "@prisma/client";

/**
 * Task Verification Engine (Phase 3 S2).
 *
 * One entry point — `verifyTask(task, userId)` — dispatches to a per-type
 * verifier. Adding a provider = adding a case here; nothing else changes.
 * Raffles gate on it now; campaigns/points (S3) reuse it as-is.
 *
 * X tasks use "link + attest" on the free X API tier: the user must have a
 * linked X account (proves a real X identity via OAuth), then attests they did
 * the action. If a paid tier is configured later, real follow/like checks can
 * slot into xVerifier without touching callers.
 */

export interface TaskConfig {
  url?: string;
  xHandle?: string;
  tweetUrl?: string;
  guildId?: string;
  inviteUrl?: string;
  roleId?: string;
  roleName?: string;
  instructions?: string;
}

export interface VerifyResult {
  status: CompletionStatus;
  evidence?: Record<string, unknown>;
  /** User-facing reason when not VERIFIED. */
  reason?: string;
  /** What the user should do next. */
  action?: "link_x" | "join_discord" | "review_pending" | "none";
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  X_FOLLOW: "Follow on X",
  X_LIKE: "Like a post on X",
  X_REPOST: "Repost on X",
  X_COMMENT: "Comment on X",
  DISCORD_JOIN: "Join a Discord server",
  DISCORD_ROLE: "Hold a Discord role",
  VISIT_LINK: "Visit a link",
  MANUAL: "Manual review",
};

/** The link a task points the user at (for the task card's action button). */
export function taskActionUrl(type: TaskType, cfg: TaskConfig): string | null {
  switch (type) {
    case "X_FOLLOW":
      return cfg.xHandle ? `https://x.com/${cfg.xHandle.replace(/^@/, "")}` : null;
    case "X_LIKE":
    case "X_REPOST":
    case "X_COMMENT":
      return cfg.tweetUrl ?? null;
    case "DISCORD_JOIN":
      return cfg.inviteUrl ?? null;
    case "VISIT_LINK":
      return cfg.url ?? null;
    default:
      return null;
  }
}

export async function verifyTask(task: TaskDefinition, userId: string): Promise<VerifyResult> {
  const cfg = (task.config ?? {}) as TaskConfig;
  if (!task.active) return { status: "REJECTED", reason: "This task is no longer active." };
  if (task.expiresAt && task.expiresAt < new Date()) {
    return { status: "REJECTED", reason: "This task has expired." };
  }

  switch (task.type) {
    case "X_FOLLOW":
    case "X_LIKE":
    case "X_REPOST":
    case "X_COMMENT":
      return xVerifier(task.type, cfg, userId);
    case "DISCORD_JOIN":
    case "DISCORD_ROLE":
      return discordVerifier(task.type, cfg, userId);
    case "VISIT_LINK":
      return {
        status: "VERIFIED",
        evidence: { method: "attest_visit", url: cfg.url ?? null, at: new Date().toISOString() },
      };
    case "MANUAL":
      return {
        status: "NEEDS_REVIEW",
        reason: "Submitted — the team will review it shortly.",
        action: "review_pending",
        evidence: { method: "manual_submit", at: new Date().toISOString() },
      };
    default:
      return { status: "NEEDS_REVIEW", reason: "Unsupported task type." };
  }
}

/** X tasks: require a linked X account, then attest. */
async function xVerifier(type: TaskType, cfg: TaskConfig, userId: string): Promise<VerifyResult> {
  const linked = await prisma.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "X" } },
    select: { externalId: true, handle: true },
  });
  if (!linked) {
    return {
      status: "PENDING",
      reason: "Link your X account first, then verify again.",
      action: "link_x",
    };
  }
  return {
    status: "VERIFIED",
    evidence: {
      method: "x_link_attest",
      xUserId: linked.externalId,
      xHandle: linked.handle,
      target: cfg.xHandle ?? cfg.tweetUrl ?? null,
      type,
      at: new Date().toISOString(),
    },
  };
}

/** Discord tasks: verified for real via the bot token. */
async function discordVerifier(
  type: TaskType,
  cfg: TaskConfig,
  userId: string,
): Promise<VerifyResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!cfg.guildId) return { status: "NEEDS_REVIEW", reason: "Task is missing its server." };
  if (!botToken) {
    return { status: "NEEDS_REVIEW", reason: "Automatic check unavailable — sent to review." };
  }

  const res = await fetch(
    `https://discord.com/api/guilds/${cfg.guildId}/members/${userId}`,
    { headers: { authorization: `Bot ${botToken}` }, cache: "no-store" },
  );
  if (res.status === 404) {
    return {
      status: "PENDING",
      reason: "You haven't joined the Discord server yet.",
      action: "join_discord",
    };
  }
  if (!res.ok) {
    return { status: "NEEDS_REVIEW", reason: "Couldn't check Discord right now — sent to review." };
  }

  const member = (await res.json()) as { roles: string[] };
  if (type === "DISCORD_ROLE") {
    if (!cfg.roleId || !member.roles.includes(cfg.roleId)) {
      return {
        status: "PENDING",
        reason: `You don't have the ${cfg.roleName ?? "required"} role yet.`,
      };
    }
  }
  return {
    status: "VERIFIED",
    evidence: {
      method: "bot_member_check",
      guildId: cfg.guildId,
      ...(type === "DISCORD_ROLE" ? { roleId: cfg.roleId } : {}),
      at: new Date().toISOString(),
    },
  };
}
