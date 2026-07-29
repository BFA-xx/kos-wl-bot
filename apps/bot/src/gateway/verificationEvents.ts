import {
  PermissionFlagsBits,
  type GuildBasedChannel,
  type GuildMember,
} from "discord.js";
import { prisma } from "@kos/db";
import { logger } from "../logger.js";
import { logVerification } from "../services/verificationLogger.js";
import { applyVerificationAccessToNewChannel } from "../services/verificationSettingsService.js";

/** Assign the configured Unverified role as soon as a human member joins. */
export async function handleVerificationMemberJoin(
  member: GuildMember,
): Promise<void> {
  if (member.user.bot) return;
  const settings = await prisma.verificationSettings.findUnique({
    where: { guildId: member.guild.id },
  });
  if (!settings?.enabled || !settings.unverifiedRoleId) return;

  try {
    const botMember =
      member.guild.members.me ??
      (await member.guild.members.fetchMe().catch(() => null));
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error("KOS is missing Manage Roles.");
    }
    const role =
      member.guild.roles.cache.get(settings.unverifiedRoleId) ??
      (await member.guild.roles
        .fetch(settings.unverifiedRoleId)
        .catch(() => null));
    if (!role) throw new Error("Configured Unverified role no longer exists.");
    if (!role.editable) {
      throw new Error("KOS bot role is not above the Unverified role.");
    }
    await member.roles.add(role, "KOS verification onboarding");
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Could not assign Unverified role on join: ${error.message}`
        : "Could not assign Unverified role on join.";
    logger.error(
      { error, guildId: member.guild.id, userId: member.id },
      "verification join role failed",
    );
    await logVerification({
      client: member.client,
      guild: member.guild,
      userId: member.id,
      success: false,
      reason,
    });
  }
}

/** Newly created channels start hidden from Unverified members by default. */
export async function handleVerificationChannelCreate(
  channel: GuildBasedChannel,
): Promise<void> {
  try {
    await applyVerificationAccessToNewChannel(channel);
  } catch (error) {
    logger.error(
      { error, guildId: channel.guild.id, channelId: channel.id },
      "verification access for new channel failed",
    );
  }
}
