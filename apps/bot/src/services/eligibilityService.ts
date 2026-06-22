import {
  type GuildMember,
  type Guild as DiscordGuild,
  type TextChannel,
} from "discord.js";
import { RoleMatchMode } from "@kos/db";
import {
  entryRequirementsSchema,
  type EligibilityResult,
  type EntryRequirements,
} from "../types.js";
import { isBlacklisted } from "./blacklistService.js";
import { logger } from "../logger.js";

const DAY_MS = 86_400_000;

interface RaffleLike {
  id: number;
  guildId: string;
  roleMatchMode: RoleMatchMode;
  eligibleRoles: { roleId: string; roleName: string }[];
  requirements: unknown;
}

/**
 * Parse the JSON requirements blob into a typed object, tolerating null/legacy.
 */
export function parseRequirements(raw: unknown): EntryRequirements {
  if (!raw) return {};
  const result = entryRequirementsSchema.safeParse(raw);
  return result.success ? result.data : {};
}

/**
 * Evaluate whether `member` may enter `raffle`. Performs role-match checks,
 * blacklist checks, and anti-alt requirement checks. Returns blocking reasons
 * and non-blocking suspicion flags.
 */
export async function evaluateEligibility(
  member: GuildMember,
  raffle: RaffleLike,
): Promise<EligibilityResult> {
  const reasons: string[] = [];
  const flags: string[] = [];

  // 1. Blacklist (hard block).
  if (await isBlacklisted(raffle.guildId, member.id)) {
    return {
      eligible: false,
      reasons: ["You are blacklisted from raffles in this server."],
      flags: [],
    };
  }

  // 2. Role eligibility.
  if (raffle.eligibleRoles.length > 0) {
    const owned = raffle.eligibleRoles.filter((r) =>
      member.roles.cache.has(r.roleId),
    );
    if (raffle.roleMatchMode === RoleMatchMode.ALL) {
      const missing = raffle.eligibleRoles.filter(
        (r) => !member.roles.cache.has(r.roleId),
      );
      if (missing.length > 0) {
        reasons.push(
          `You must hold all required roles: ${raffle.eligibleRoles
            .map((r) => r.roleName)
            .join(", ")}.`,
        );
      }
    } else if (owned.length === 0) {
      reasons.push(
        `You need at least one eligible role: ${raffle.eligibleRoles
          .map((r) => r.roleName)
          .join(", ")}.`,
      );
    }
  }

  // 3. Anti-alt requirements.
  const req = parseRequirements(raffle.requirements);

  if (req.requiredRoleIds?.length) {
    const missing = req.requiredRoleIds.filter(
      (rid) => !member.roles.cache.has(rid),
    );
    if (missing.length > 0) {
      reasons.push("You are missing one or more required roles for this raffle.");
    }
  }

  if (req.minAccountAgeDays && req.minAccountAgeDays > 0) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / DAY_MS;
    if (ageDays < req.minAccountAgeDays) {
      reasons.push(
        `Your Discord account must be at least ${req.minAccountAgeDays} days old.`,
      );
      flags.push("account_too_new");
    }
  }

  if (req.minServerAgeDays && req.minServerAgeDays > 0) {
    const joined = member.joinedTimestamp;
    if (joined === null) {
      flags.push("join_date_unknown");
    } else {
      const joinDays = (Date.now() - joined) / DAY_MS;
      if (joinDays < req.minServerAgeDays) {
        reasons.push(
          `You must have been in the server for at least ${req.minServerAgeDays} days.`,
        );
        flags.push("recent_join");
      }
    }
  }

  if (req.minMessages && req.minMessages > 0) {
    // Message-count gating requires an external activity provider (e.g. a
    // leveling bot). Without one, we cannot block on it — flag for review.
    flags.push("message_count_unverified");
  }

  if (req.requiredReaction) {
    const reacted = await hasReacted(member, req.requiredReaction).catch(
      (err) => {
        logger.warn({ err }, "reaction check failed");
        return null;
      },
    );
    if (reacted === false) {
      reasons.push("You must react to the announcement post to enter.");
    }
  }

  return { eligible: reasons.length === 0, reasons, flags };
}

async function hasReacted(
  member: GuildMember,
  required: NonNullable<EntryRequirements["requiredReaction"]>,
): Promise<boolean> {
  const guild: DiscordGuild = member.guild;
  const channel = await guild.channels
    .fetch(required.channelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased()) return true; // can't verify → don't block

  const message = await (channel as TextChannel).messages
    .fetch(required.messageId)
    .catch(() => null);
  if (!message) return true;

  const reaction =
    message.reactions.cache.get(required.emoji) ??
    message.reactions.cache.find((r) => r.emoji.name === required.emoji);
  if (!reaction) return false;

  const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
  if (!users) return true;
  return users.has(member.id);
}
