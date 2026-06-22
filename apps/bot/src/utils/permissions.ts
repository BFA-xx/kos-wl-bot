import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma } from "@kos/db";

/**
 * Determine whether the invoking member is authorised to manage raffles.
 *
 * A member qualifies if they:
 *  - are the server owner, OR
 *  - have the Administrator or Manage Server permission, OR
 *  - hold one of the guild's configured manager roles.
 *
 * Uses `interaction.memberPermissions` (supplied directly in the interaction
 * payload) so it works even when the member/guild isn't fully cached.
 */
export async function isRaffleManager(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.inGuild()) return false;

  // Server owner always qualifies.
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) {
    return true;
  }

  // Permission flags from the interaction payload (reliable without cache).
  const perms = interaction.memberPermissions;
  if (
    perms &&
    (perms.has(PermissionFlagsBits.Administrator) ||
      perms.has(PermissionFlagsBits.ManageGuild))
  ) {
    return true;
  }

  // Configured manager roles.
  const guild = await prisma.guild.findUnique({
    where: { id: interaction.guildId! },
    select: { managerRoleIds: true },
  });
  if (!guild || guild.managerRoleIds.length === 0) return false;

  return guild.managerRoleIds.some((roleId) => memberHasRole(interaction, roleId));
}

/** Read the invoker's role ids whether the member is cached or raw (API form). */
function memberHasRole(
  interaction: ChatInputCommandInteraction,
  roleId: string,
): boolean {
  const member = interaction.member;
  if (!member) return false;
  const roles = member.roles;
  // Cached guild: GuildMemberRoleManager with a `cache` collection.
  if (roles && !Array.isArray(roles) && "cache" in roles) {
    return roles.cache.has(roleId);
  }
  // Uncached: plain array of role id strings.
  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }
  return false;
}
