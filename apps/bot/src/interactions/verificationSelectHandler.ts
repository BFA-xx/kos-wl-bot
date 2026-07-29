import {
  MessageFlags,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
} from "discord.js";
import { LogCategory, Prisma } from "@kos/db";
import { Actions } from "../utils/ids.js";
import { isKOSManager } from "../utils/permissions.js";
import {
  clearVerificationRoleAccess,
  getOrCreateVerificationSettings,
  syncVerificationChannelAccess,
  updateVerificationSettings,
} from "../services/verificationSettingsService.js";
import { setVerificationCodeRoles } from "../services/verificationCodeService.js";
import {
  buildVerificationChannelsPanel,
  buildVerificationCodeRolesPrompt,
  buildVerificationRolesPanel,
} from "./verificationAdmin.js";
import { audit } from "../services/auditService.js";
import { KOS } from "../theme.js";

const VERIFICATION_SELECT_ACTIONS = new Set<string>([
  Actions.VerificationSetVerifyChannel,
  Actions.VerificationSetRulesChannel,
  Actions.VerificationSetLogChannel,
  Actions.VerificationSetAllowedChannels,
  Actions.VerificationSetUnverifiedRole,
  Actions.VerificationSetDefaultRoles,
  Actions.VerificationCodeRoles,
]);

type VerificationSelectInteraction =
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction;

export function isVerificationSelectAction(action: string): boolean {
  return VERIFICATION_SELECT_ACTIONS.has(action);
}

export async function handleVerificationSelect(
  interaction: VerificationSelectInteraction,
  action: string,
  args: string[],
): Promise<unknown> {
  if (!(await isKOSManager(interaction))) {
    return interaction.reply({
      content: "You do not have permission to manage KOS verification.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();

  try {
    if (action === Actions.VerificationCodeRoles) {
      const settings = await getOrCreateVerificationSettings(
        interaction.guildId,
      );
      const roleIds = interaction.values.filter(
        (roleId) =>
          roleId !== interaction.guildId &&
          roleId !== settings.unverifiedRoleId,
      );
      for (const roleId of roleIds) {
        const role =
          interaction.guild.roles.cache.get(roleId) ??
          (await interaction.guild.roles.fetch(roleId).catch(() => null));
        if (!role?.editable) {
          throw new Error(
            `KOS cannot assign ${role ? `@${role.name}` : roleId}. Move the bot role above it.`,
          );
        }
      }
      const code = await setVerificationCodeRoles({
        id: args[0] ?? "",
        guildId: interaction.guildId,
        roleIds,
      });
      await recordChange(
        interaction,
        "VERIFICATION_CODE_ROLES_UPDATE",
        `Updated role grants for code ${code.code}`,
        { codeId: code.id, roleIds },
      );
      return interaction.editReply(buildVerificationCodeRolesPrompt(code));
    }

    if (
      action === Actions.VerificationSetUnverifiedRole ||
      action === Actions.VerificationSetDefaultRoles
    ) {
      return handleRoleSelect(interaction, action);
    }
    return handleChannelSelect(interaction, action);
  } catch (error) {
    return interaction.followUp({
      content: `${KOS.emoji.cross} ${error instanceof Error ? error.message : "Could not save that selection."}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleChannelSelect(
  interaction: VerificationSelectInteraction & { guildId: string },
  action: string,
) {
  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  if (action === Actions.VerificationSetVerifyChannel) {
    const nextChannelId = interaction.values[0]!;
    if (
      settings.panelMessageId &&
      settings.verificationChannelId &&
      settings.verificationChannelId !== nextChannelId
    ) {
      const previous = await interaction.guild?.channels
        .fetch(settings.verificationChannelId)
        .catch(() => null);
      if (
        previous &&
        previous.isTextBased() &&
        !previous.isDMBased() &&
        "messages" in previous
      ) {
        await previous.messages
          .delete(settings.panelMessageId)
          .catch(() => undefined);
      }
    }
    await updateVerificationSettings(interaction.guildId, {
      verificationChannelId: nextChannelId,
      ...(settings.verificationChannelId !== nextChannelId
        ? {
            panelMessageId: null,
            panelPublishedAt: null,
          }
        : {}),
    });
  } else if (action === Actions.VerificationSetRulesChannel) {
    await updateVerificationSettings(interaction.guildId, {
      rulesChannelId: interaction.values[0]!,
    });
  } else if (action === Actions.VerificationSetLogChannel) {
    await updateVerificationSettings(interaction.guildId, {
      logChannelId: interaction.values[0]!,
    });
  } else if (action === Actions.VerificationSetAllowedChannels) {
    await updateVerificationSettings(interaction.guildId, {
      allowedChannelIds: { set: [...new Set(interaction.values)].slice(0, 10) },
    });
  } else {
    throw new Error("Unknown verification channel selection.");
  }

  const updated = await getOrCreateVerificationSettings(interaction.guildId);
  if (updated.enabled && action !== Actions.VerificationSetLogChannel) {
    await syncVerificationChannelAccess(interaction.guild!, updated);
  }
  await recordChange(
    interaction,
    "VERIFICATION_CHANNELS_UPDATE",
    "Updated verification channels",
    { action, values: interaction.values },
  );
  return interaction.editReply(buildVerificationChannelsPanel(updated));
}

async function handleRoleSelect(
  interaction: VerificationSelectInteraction & { guildId: string },
  action: string,
) {
  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  if (action === Actions.VerificationSetDefaultRoles) {
    const roleIds = [...new Set(interaction.values)].filter(
      (roleId) =>
        roleId !== interaction.guildId && roleId !== settings.unverifiedRoleId,
    );
    for (const roleId of roleIds) {
      const role =
        interaction.guild?.roles.cache.get(roleId) ??
        (await interaction.guild?.roles.fetch(roleId).catch(() => null));
      if (!role?.editable) {
        throw new Error(
          `KOS cannot assign ${role ? `@${role.name}` : roleId}. Move the bot role above it.`,
        );
      }
    }
    const updated = await updateVerificationSettings(interaction.guildId, {
      defaultRoleIds: { set: roleIds.slice(0, 10) },
    });
    await recordChange(
      interaction,
      "VERIFICATION_DEFAULT_ROLES_UPDATE",
      "Updated default verification roles",
      { roleIds },
    );
    return interaction.editReply(buildVerificationRolesPanel(updated));
  }

  const nextRoleId = interaction.values[0]!;
  if (nextRoleId === interaction.guildId) {
    throw new Error("@everyone cannot be used as the Unverified role.");
  }
  const nextRole =
    interaction.guild?.roles.cache.get(nextRoleId) ??
    (await interaction.guild?.roles.fetch(nextRoleId).catch(() => null));
  if (!nextRole?.editable) {
    throw new Error(
      `KOS cannot manage ${nextRole ? `@${nextRole.name}` : nextRoleId}. Move the bot role above it.`,
    );
  }
  const oldRoleId = settings.unverifiedRoleId;
  const updated = await updateVerificationSettings(interaction.guildId, {
    unverifiedRoleId: nextRoleId,
    defaultRoleIds: {
      set: settings.defaultRoleIds.filter((roleId) => roleId !== nextRoleId),
    },
  });
  if (settings.enabled) {
    try {
      await syncVerificationChannelAccess(interaction.guild!, updated);
      if (oldRoleId && oldRoleId !== nextRoleId) {
        await clearVerificationRoleAccess(interaction.guild!, oldRoleId);
      }
    } catch (error) {
      await updateVerificationSettings(interaction.guildId, {
        unverifiedRoleId: oldRoleId,
        defaultRoleIds: { set: settings.defaultRoleIds },
      });
      await clearVerificationRoleAccess(interaction.guild!, nextRoleId).catch(
        () => undefined,
      );
      if (oldRoleId) {
        await syncVerificationChannelAccess(interaction.guild!).catch(
          () => undefined,
        );
      }
      throw error;
    }
  } else if (oldRoleId && oldRoleId !== nextRoleId) {
    await clearVerificationRoleAccess(interaction.guild!, oldRoleId).catch(
      () => undefined,
    );
  }
  await recordChange(
    interaction,
    "VERIFICATION_UNVERIFIED_ROLE_UPDATE",
    `Updated Unverified role to ${nextRole.name}`,
    { roleId: nextRoleId },
  );
  return interaction.editReply(buildVerificationRolesPanel(updated));
}

async function recordChange(
  interaction: VerificationSelectInteraction & { guildId: string },
  action: string,
  message: string,
  metadata: Prisma.InputJsonObject,
) {
  await audit({
    guildId: interaction.guildId,
    category: LogCategory.VERIFICATION,
    action,
    message,
    actorId: interaction.user.id,
    metadata,
  });
}
