export type CommandRegistrationTarget =
  | { scope: "guild"; guildId: string }
  | { scope: "global"; compatibilityGuildId: string | null };

/**
 * Production deploys pass --global so every installed guild receives the same
 * command surface. The configured guild is mirrored during the transition so
 * its old instant-registration override never becomes stale.
 */
export function resolveCommandRegistrationTarget(
  args: string[],
  configuredGuildId?: string,
): CommandRegistrationTarget {
  if (args.includes("--global")) {
    return {
      scope: "global",
      compatibilityGuildId: configuredGuildId?.trim() || null,
    };
  }
  const guildId = configuredGuildId?.trim();
  return guildId
    ? { scope: "guild", guildId }
    : { scope: "global", compatibilityGuildId: null };
}
