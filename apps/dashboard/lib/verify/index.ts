import { prisma } from "@/lib/db";
import {
  claimVerificationSlot,
  logXCacheHit,
  verifyXEngagement,
  verifyXFollow,
  xSweepConfigured,
  xVerifyConfigured,
} from "@kos/db";
import type { TaskDefinition, TaskType, CompletionStatus } from "@prisma/client";

/**
 * Task Verification Engine (Phase 3 S2).
 *
 * One entry point — `verifyTask(task, userId)` — dispatches to a per-type
 * verifier. Adding a provider = adding a case here; nothing else changes.
 * Raffles gate on it now; campaigns/points (S3) reuse it as-is.
 *
 * X tasks all require a linked X account (OAuth proves a real X identity).
 * Follows, likes and reposts are then checked against the X API for real;
 * comments still attest. See packages/db/src/x-verify.ts for the cost model
 * and the sweep cap behind likes/reposts.
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
      return xVerifier(task, cfg, userId);
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

/**
 * X tasks: require a linked X account, then check follows for real and attest
 * the rest.
 *
 * Every inconclusive answer from X (budget spent, rate limited, outage, access
 * level too low) falls through to attest rather than rejecting — a billing or
 * API problem must never cost a member a task they actually did.
 */
async function xVerifier(
  task: TaskDefinition,
  cfg: TaskConfig,
  userId: string,
): Promise<VerifyResult> {
  const type = task.type;
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

  // About to spend? Claim the slot first. This collapses double-clicks and
  // refresh-spam into one paid call, and reuses a recent negative answer
  // instead of re-buying it — the biggest single source of wasted credits.
  const willSpend =
    (type === "X_FOLLOW" && Boolean(cfg.xHandle) && xVerifyConfigured()) ||
    ((type === "X_LIKE" || type === "X_REPOST") &&
      Boolean(cfg.tweetUrl) &&
      xSweepConfigured());

  if (willSpend) {
    const slot = await claimVerificationSlot(prisma, { taskId: task.id, userId });
    if (!slot.proceed) {
      await logXCacheHit(prisma, {
        endpoint: "verify/claim",
        operation: type === "X_FOLLOW" ? "follow_check" : "engager_sweep_page",
        organizationId: task.organizationId,
        taskId: task.id,
        userId,
        xUserId: linked.externalId,
        outcome: slot.reason,
      });
      return {
        status: "PENDING",
        reason:
          slot.reason === "in_flight"
            ? "Already checking — give it a moment."
            : `Just checked. Try again in ${slot.retryAfterSeconds}s.`,
      };
    }
  }

  if ((type === "X_LIKE" || type === "X_REPOST") && cfg.tweetUrl && xSweepConfigured()) {
    const kind = type === "X_LIKE" ? "LIKE" : "REPOST";
    const check = await verifyXEngagement(prisma, {
      userId,
      tweetUrl: cfg.tweetUrl,
      kind,
      organizationId: task.organizationId,
      taskId: task.id,
    });
    const evidence = {
      method: "x_api_engager_sweep",
      xUserId: linked.externalId,
      xHandle: linked.handle,
      target: cfg.tweetUrl,
      type,
      outcome: check.outcome,
      sweepComplete: check.complete ?? false,
      at: new Date().toISOString(),
    };

    if (check.outcome === "engaged") return { status: "VERIFIED", evidence };
    if (check.outcome === "not_engaged") {
      return {
        status: "PENDING",
        reason:
          type === "X_LIKE"
            ? "We couldn't find your like on that post yet. Like it, then verify again."
            : "We couldn't find your repost yet. Repost it (a quote post doesn't count), then verify again.",
      };
    }
    // Anything else means the sweep couldn't prove a negative — attest.
  }

  if (type === "X_FOLLOW" && cfg.xHandle && xVerifyConfigured()) {
    const check = await verifyXFollow(prisma, {
      userId,
      targetHandle: cfg.xHandle,
      organizationId: task.organizationId,
      taskId: task.id,
    });
    const target = cfg.xHandle.replace(/^@/, "");
    const evidence = {
      method: "x_api_connection_status",
      xUserId: linked.externalId,
      xHandle: linked.handle,
      target,
      type,
      outcome: check.outcome,
      at: new Date().toISOString(),
    };

    switch (check.outcome) {
      case "following":
        return { status: "VERIFIED", evidence };
      case "follow_pending":
        // Protected account: the request is sent, which is all the member can do.
        return { status: "VERIFIED", evidence };
      case "not_following":
        return {
          status: "PENDING",
          reason: `You're not following @${target} yet. Follow, then verify again.`,
        };
      case "token_expired":
        return {
          status: "PENDING",
          reason: "Your X connection expired. Reconnect X, then verify again.",
          action: "link_x",
        };
      default:
        // disabled / budget_exhausted / rate_limited / unavailable → attest.
        break;
    }
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
