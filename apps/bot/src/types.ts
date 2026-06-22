import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  AutocompleteInteraction,
} from "discord.js";
import { z } from "zod";

/**
 * Anti-farmer / anti-alt requirements stored as JSON on a raffle.
 * All fields are optional; absent means "no requirement".
 */
export const entryRequirementsSchema = z.object({
  /** Minimum Discord account age in days. */
  minAccountAgeDays: z.number().int().nonnegative().optional(),
  /** Minimum time since joining the server, in days. */
  minServerAgeDays: z.number().int().nonnegative().optional(),
  /** Minimum message count (best-effort; requires an activity provider). */
  minMessages: z.number().int().nonnegative().optional(),
  /** Roles that must additionally be owned (beyond eligible roles). */
  requiredRoleIds: z.array(z.string()).optional(),
  /** Require a reaction on a specific announcement message. */
  requiredReaction: z
    .object({
      channelId: z.string(),
      messageId: z.string(),
      emoji: z.string(),
    })
    .optional(),
  /**
   * Off-platform tasks shown to entrants (follow on X, like/RT a post, join a
   * Discord, etc.). Displayed as links in the raffle embed. X/like/RT actions
   * can't be auto-verified without the paid X API, so these are shown as
   * required steps and entrants confirm by entering (honor system).
   */
  tasks: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
      }),
    )
    .optional(),
});

export type EntryRequirements = z.infer<typeof entryRequirementsSchema>;

/** A slash command module. */
export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  /** When true, command is only usable by configured guild managers. */
  managerOnly?: boolean;
  // Handlers commonly `return interaction.reply(...)` for early-exit; the
  // returned value is ignored by the router, so the return type is widened.
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
}

/** Result of an eligibility evaluation. */
export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable reasons the user failed (empty when eligible). */
  reasons: string[];
  /** Soft flags that do not block entry but mark the account as suspicious. */
  flags: string[];
}
