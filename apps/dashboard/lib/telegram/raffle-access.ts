import type { Context } from "grammy";
import type { User as TelegramUser } from "grammy/types";
import type { TelegramCommunity, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  evaluateWebGates,
  fetchGuildMember,
  type RaffleWithRoles,
  type RestMember,
} from "@/lib/raffle-entry";
import { dashboardOrigin } from "@/lib/telegram/format";

/**
 * One evaluation of "can this Telegram user enter this raffle", shared by the
 * raffle card and the Enter button.
 *
 * Before this existed the card advertised "standard KOS checks" and the member
 * discovered the real answer only after tapping, as one of seven alerts. The
 * card and the button must never be able to disagree, so both call this.
 *
 * Ordering matters for cost as much as for logic: the Discord REST lookup is
 * last, so a member blocked earlier never pays for it.
 */

export type TelegramRaffleBlock =
  | "not_in_community"
  | "approval_pending"
  | "approval_rejected"
  | "not_linked"
  | "not_live"
  | "requirements"
  | "discord_unconfirmed";

export type CheckStatus = "pass" | "fail" | "pending";

export interface TelegramRaffleCheck {
  key: "community" | "approval" | "profile" | "status" | "requirements";
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface TelegramRaffleAccess {
  checks: TelegramRaffleCheck[];
  alreadyEntered: boolean;
  canEnter: boolean;
  block: TelegramRaffleBlock | null;
  /** User-facing explanation of `block`, ready for a callback alert. */
  message: string | null;
  /** A link that helps clear the block, when one exists. */
  actionUrl: string | null;
  /** Everything `recordWebEntry` needs. Non-null only when `canEnter`. */
  ready: { user: User; accountId: string; member: RestMember } | null;
}

function isActiveMembership(status: string | undefined, isMember?: boolean) {
  return (
    status === "creator" ||
    status === "administrator" ||
    status === "member" ||
    (status === "restricted" && isMember === true)
  );
}

/**
 * Keep `TelegramCommunityMember` in step with the group's real roster.
 * Idempotent, and deliberately run on both the preview and the entry path so
 * viewing a raffle refreshes stale membership the same way entering does.
 */
export async function reconcileTelegramMembership(
  ctx: Context,
  community: TelegramCommunity,
  telegramUser: TelegramUser,
  identityId: string,
) {
  let member = await prisma.telegramCommunityMember.findUnique({
    where: {
      communityId_telegramUserId: {
        communityId: community.id,
        telegramUserId: String(telegramUser.id),
      },
    },
  });

  if (!member || member.status !== "ACTIVE") {
    const live = await ctx.api
      .getChatMember(community.telegramChatId, telegramUser.id)
      .catch(() => null);
    const active = isActiveMembership(
      live?.status,
      live && "is_member" in live ? live.is_member : undefined,
    );
    if (active && !member) {
      member = await prisma.telegramCommunityMember.create({
        data: {
          communityId: community.id,
          telegramUserId: String(telegramUser.id),
          identityId,
          status: "ACTIVE",
          approvalStatus: "PENDING",
        },
      });
    } else if (active && member) {
      member = await prisma.telegramCommunityMember.update({
        where: { id: member.id },
        data: {
          identityId,
          status: "ACTIVE",
          leftAt: null,
          lastSeenAt: new Date(),
        },
      });
    }
  } else if (!member.identityId) {
    member = await prisma.telegramCommunityMember.update({
      where: { id: member.id },
      data: { identityId, lastSeenAt: new Date() },
    });
  }

  return member;
}

export async function evaluateTelegramRaffleAccess(
  ctx: Context,
  telegramUser: TelegramUser,
  identityId: string,
  community: TelegramCommunity,
  raffle: RaffleWithRoles,
): Promise<TelegramRaffleAccess> {
  const checks: TelegramRaffleCheck[] = [];
  const pending = (
    key: TelegramRaffleCheck["key"],
    label: string,
  ): TelegramRaffleCheck => ({ key, label, status: "pending" });

  const blocked = (
    block: TelegramRaffleBlock,
    message: string,
    actionUrl: string | null = null,
    rest: TelegramRaffleCheck[] = [],
  ): TelegramRaffleAccess => ({
    checks: [...checks, ...rest],
    alreadyEntered: false,
    canEnter: false,
    block,
    message,
    actionUrl,
    ready: null,
  });

  // 1. Telegram group membership.
  const member = await reconcileTelegramMembership(
    ctx,
    community,
    telegramUser,
    identityId,
  );
  if (!member || member.status !== "ACTIVE") {
    checks.push({
      key: "community",
      label: "In the community",
      status: "fail",
      detail: "Join the Telegram group first.",
    });
    return blocked(
      "not_in_community",
      "Join this Telegram community before entering its raffle.",
      null,
      [
        pending("approval", "Access approved"),
        pending("profile", "KOS profile linked"),
        pending("status", "Raffle open"),
        pending("requirements", "Entry requirements"),
      ],
    );
  }
  checks.push({
    key: "community",
    label: "In the community",
    status: "pass",
  });

  // 2. KOS team approval of that membership.
  if (member.approvalStatus !== "APPROVED") {
    const rejected = member.approvalStatus === "REJECTED";
    checks.push({
      key: "approval",
      label: "Access approved",
      status: "fail",
      detail: rejected
        ? "Your access request was not approved."
        : "Waiting for the team to review your request.",
    });
    return blocked(
      rejected ? "approval_rejected" : "approval_pending",
      rejected
        ? "Your KOS community access request was not approved."
        : "Your KOS community access request is waiting for team approval.",
      null,
      [
        pending("profile", "KOS profile linked"),
        pending("status", "Raffle open"),
        pending("requirements", "Entry requirements"),
      ],
    );
  }
  checks.push({ key: "approval", label: "Access approved", status: "pass" });

  // 3. Linked KOS profile — entries are recorded against the Discord-backed User.
  const account = await prisma.connectedAccount.findUnique({
    where: {
      provider_externalId: {
        provider: "TELEGRAM",
        externalId: String(telegramUser.id),
      },
    },
    include: { user: true },
  });
  if (!account) {
    checks.push({
      key: "profile",
      label: "KOS profile linked",
      status: "fail",
      detail: "Connect Telegram from your KOS profile.",
    });
    return blocked(
      "not_linked",
      `Connect Telegram from ${dashboardOrigin()}/me, then try again.`,
      `${dashboardOrigin()}/me`,
      [
        pending("status", "Raffle open"),
        pending("requirements", "Entry requirements"),
      ],
    );
  }
  checks.push({
    key: "profile",
    label: "KOS profile linked",
    status: "pass",
  });

  // 4. Raffle state.
  if (raffle.status !== "LIVE") {
    checks.push({
      key: "status",
      label: "Raffle open",
      status: "fail",
      detail:
        raffle.status === "UPCOMING"
          ? "Entries have not opened yet."
          : "Entries are closed.",
    });
    return blocked("not_live", "This raffle is not open for entries.", null, [
      pending("requirements", "Entry requirements"),
    ]);
  }
  checks.push({ key: "status", label: "Raffle open", status: "pass" });

  // 5. Already in? Not a failure — it changes which buttons the card offers.
  const existing = await prisma.participant.findUnique({
    where: { raffleId_userId: { raffleId: raffle.id, userId: account.userId } },
    select: { id: true },
  });
  if (existing) {
    checks.push({
      key: "requirements",
      label: "Entry requirements",
      status: "pass",
      detail: "You are entered.",
    });
    return {
      checks,
      alreadyEntered: true,
      canEnter: false,
      block: null,
      message: null,
      actionUrl: null,
      ready: null,
    };
  }

  // 6. The same gates the website and the Discord bot enforce.
  const report = await evaluateWebGates(account.user, raffle);
  if (!report.canEnter) {
    const reasons = report.gates.flatMap((gate) =>
      gate.ok ? [] : [gate.reason ?? gate.label],
    );
    checks.push({
      key: "requirements",
      label: "Entry requirements",
      status: "fail",
      detail: reasons.join(" · ") || "Some requirements are not met yet.",
    });
    return blocked(
      "requirements",
      reasons.join(" ") || "You do not meet this raffle's requirements yet.",
      report.gates.find((gate) => !gate.ok && gate.url)?.url ?? null,
    );
  }

  // 7. Discord membership — the most expensive check, so it runs last.
  const discordMember = await fetchGuildMember(raffle.guildId, account.userId);
  if (discordMember === "not_member" || discordMember === "unavailable") {
    checks.push({
      key: "requirements",
      label: "Entry requirements",
      status: "fail",
      detail:
        discordMember === "not_member"
          ? "Join the Discord server for this community."
          : "KOS could not reach Discord just now.",
    });
    return blocked(
      "discord_unconfirmed",
      "KOS could not confirm your Discord membership right now.",
    );
  }
  checks.push({
    key: "requirements",
    label: "Entry requirements",
    status: "pass",
  });

  return {
    checks,
    alreadyEntered: false,
    canEnter: true,
    block: null,
    message: null,
    actionUrl: null,
    ready: { user: account.user, accountId: account.id, member: discordMember },
  };
}

const STATUS_MARK: Record<CheckStatus, string> = {
  pass: "✅",
  fail: "❌",
  pending: "▫️",
};

/** Render the checklist for a Telegram raffle card. */
export function renderAccessChecklist(
  access: TelegramRaffleAccess,
  escape: (value: string) => string,
): string[] {
  return access.checks.map((check) => {
    const mark = STATUS_MARK[check.status];
    const detail = check.detail ? ` — ${escape(check.detail)}` : "";
    return `${mark} ${escape(check.label)}${detail}`;
  });
}
