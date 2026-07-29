import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from "discord.js";
import { LogCategory, Prisma, prisma } from "@kos/db";
import { Actions, buildId } from "../utils/ids.js";
import { isKOSManager } from "../utils/permissions.js";
import {
  beginVerification,
  finalizeVerification,
  renderVerificationMessage,
} from "../services/verificationService.js";
import {
  buildVerificationOutcomeMessage,
  buildVerificationRulesMessage,
} from "../embeds/verificationEmbed.js";
import {
  getOrCreateVerificationSettings,
  publishVerificationPanel,
  refreshPublishedVerificationPanel,
  setVerificationEnabled,
  syncVerificationChannelAccess,
  updateVerificationSettings,
  VerificationSettingsError,
} from "../services/verificationSettingsService.js";
import {
  buildVerificationAdminPanel,
  buildVerificationChannelsPanel,
  buildVerificationMessagesModal,
  buildVerificationModalCopyModal,
  buildVerificationRolesPanel,
  buildVerificationWelcomeModal,
} from "./verificationAdmin.js";
import { handleVerificationRulesAcceptance } from "./verificationRulesHandler.js";
import {
  deleteVerificationCode,
  setVerificationCodeRoles,
} from "../services/verificationCodeService.js";
import { audit } from "../services/auditService.js";
import { KOS } from "../theme.js";

const VERIFICATION_BUTTON_ACTIONS = new Set<string>([
  Actions.VerificationStart,
  Actions.VerificationAgreeRules,
  Actions.VerificationAdminPanel,
  Actions.VerificationAdminChannels,
  Actions.VerificationAdminRoles,
  Actions.VerificationToggle,
  Actions.VerificationEditWelcome,
  Actions.VerificationEditModal,
  Actions.VerificationEditMessages,
  Actions.VerificationPublish,
  Actions.VerificationSyncAccess,
  Actions.VerificationClearSetting,
  Actions.VerificationCodeDelete,
  Actions.VerificationCodeCancel,
]);

export function isVerificationButtonAction(action: string): boolean {
  return VERIFICATION_BUTTON_ACTIONS.has(action);
}

export async function handleVerificationButton(
  interaction: ButtonInteraction,
  action: string,
  args: string[],
): Promise<unknown> {
  if (action === Actions.VerificationStart) {
    return handleVerificationStart(interaction);
  }
  if (action === Actions.VerificationAgreeRules) {
    return handleVerificationRulesAcceptance(interaction, args[0] ?? "");
  }
  if (!(await requireVerificationManager(interaction))) return;
  if (!interaction.inCachedGuild()) return;

  try {
    switch (action) {
      case Actions.VerificationAdminPanel: {
        await interaction.deferUpdate();
        return interaction.editReply(
          await buildVerificationAdminPanel(interaction.guild),
        );
      }
      case Actions.VerificationAdminChannels: {
        const settings = await getOrCreateVerificationSettings(
          interaction.guildId,
        );
        return interaction.update(buildVerificationChannelsPanel(settings));
      }
      case Actions.VerificationAdminRoles: {
        const settings = await getOrCreateVerificationSettings(
          interaction.guildId,
        );
        return interaction.update(buildVerificationRolesPanel(settings));
      }
      case Actions.VerificationToggle:
        return handleVerificationToggle(interaction, args[0] ?? "");
      case Actions.VerificationEditWelcome: {
        const settings = await getOrCreateVerificationSettings(
          interaction.guildId,
        );
        return interaction.showModal(buildVerificationWelcomeModal(settings));
      }
      case Actions.VerificationEditModal: {
        const settings = await getOrCreateVerificationSettings(
          interaction.guildId,
        );
        return interaction.showModal(buildVerificationModalCopyModal(settings));
      }
      case Actions.VerificationEditMessages: {
        const settings = await getOrCreateVerificationSettings(
          interaction.guildId,
        );
        return interaction.showModal(buildVerificationMessagesModal(settings));
      }
      case Actions.VerificationPublish:
        return handlePublish(interaction);
      case Actions.VerificationSyncAccess:
        return handleAccessSync(interaction);
      case Actions.VerificationClearSetting:
        return handleClearSetting(interaction, args);
      case Actions.VerificationCodeDelete:
        return handleCodeDelete(interaction, args[0] ?? "");
      case Actions.VerificationCodeCancel:
        return interaction.update({
          content: "Code deletion cancelled.",
          embeds: [],
          components: [],
        });
      default:
        return;
    }
  } catch (error) {
    return respondAdminError(interaction, error);
  }
}

async function handleVerificationStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({
      content: "Verification can only be completed inside the server.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({
      ...buildVerificationOutcomeMessage({
        success: false,
        message:
          "Verification is currently unavailable. Please contact a server administrator.",
      }),
      flags: MessageFlags.Ephemeral,
    });
  }
  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  if (!member) {
    return interaction.reply({
      ...buildVerificationOutcomeMessage({
        success: false,
        message:
          "KOS could not confirm your server membership. Please try again.",
      }),
      flags: MessageFlags.Ephemeral,
    });
  }
  const verified = await prisma.memberVerification.findUnique({
    where: {
      guildId_userId: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    },
  });
  if (
    verified &&
    (!settings.unverifiedRoleId ||
      !member.roles.cache.has(settings.unverifiedRoleId))
  ) {
    return interaction.reply({
      ...buildVerificationOutcomeMessage({
        success: true,
        message: renderVerificationMessage(settings.successMessage, {
          userId: interaction.user.id,
          guildName: interaction.guild.name,
          code: null,
          roleIds: verified.roleIds,
        }),
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (settings.requireCode) {
    const input = new TextInputBuilder()
      .setCustomId("verification_code")
      .setLabel(settings.modalFieldLabel.slice(0, 45))
      .setPlaceholder(settings.modalPlaceholder.slice(0, 100))
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(32)
      .setRequired(true);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(buildId(Actions.VerificationSubmitCode))
        .setTitle(settings.modalTitle.slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(input),
        ),
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const flow = await beginVerification({
      guildId: interaction.guildId,
      userId: interaction.user.id,
    });
    if (flow.settings.requireRulesAcceptance) {
      return interaction.editReply(
        buildVerificationRulesMessage({
          settings: flow.settings,
          attemptId: flow.attemptId,
          guildId: interaction.guildId,
        }),
      );
    }
    const result = await finalizeVerification({
      member,
      attemptId: flow.attemptId,
    });
    return interaction.editReply(
      buildVerificationOutcomeMessage({
        success: result.success,
        message: result.message,
      }),
    );
  } catch (error) {
    return interaction.editReply(
      buildVerificationOutcomeMessage({
        success: false,
        message:
          error instanceof Error ? error.message : settings.failureMessage,
      }),
    );
  }
}

async function handleVerificationToggle(
  interaction: ButtonInteraction<"cached">,
  field: string,
) {
  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  if (field === "enabled") {
    await interaction.deferUpdate();
    const updated = await setVerificationEnabled(
      interaction.guild,
      !settings.enabled,
    );
    await auditSettings(
      interaction,
      "VERIFICATION_TOGGLE",
      `Verification ${updated.enabled ? "enabled" : "disabled"}`,
      { enabled: updated.enabled },
    );
    await interaction.editReply(
      await buildVerificationAdminPanel(interaction.guild),
    );
    return interaction.followUp({
      content: `${KOS.emoji.check} Verification is now **${updated.enabled ? "enabled" : "disabled"}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (
    field === "rules" &&
    !settings.requireRulesAcceptance &&
    settings.enabled &&
    !settings.rulesChannelId
  ) {
    return interaction.reply({
      content: "Choose a rules channel before requiring rules acceptance.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const data =
    field === "code"
      ? { requireCode: !settings.requireCode }
      : field === "rules"
        ? { requireRulesAcceptance: !settings.requireRulesAcceptance }
        : field === "reuse"
          ? { preventCodeReuse: !settings.preventCodeReuse }
          : null;
  if (!data) {
    return interaction.reply({
      content: "Unknown verification setting.",
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferUpdate();
  await updateVerificationSettings(interaction.guildId, data);
  await auditSettings(
    interaction,
    "VERIFICATION_FLOW_UPDATE",
    `Updated verification flow setting ${field}`,
    data,
  );
  return interaction.editReply(
    await buildVerificationAdminPanel(interaction.guild),
  );
}

async function handlePublish(interaction: ButtonInteraction<"cached">) {
  await interaction.deferUpdate();
  const result = await publishVerificationPanel(interaction.guild);
  await auditSettings(
    interaction,
    "VERIFICATION_PANEL_PUBLISH",
    result.updated
      ? "Updated the verification panel"
      : "Published the verification panel",
    { messageId: result.messageId },
  );
  await interaction.editReply(
    await buildVerificationAdminPanel(interaction.guild),
  );
  return interaction.followUp({
    content: `${KOS.emoji.check} ${result.updated ? "Updated" : "Published"} the verification panel.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAccessSync(interaction: ButtonInteraction<"cached">) {
  await interaction.deferUpdate();
  const result = await syncVerificationChannelAccess(interaction.guild);
  await auditSettings(
    interaction,
    "VERIFICATION_ACCESS_SYNC",
    `Synchronized verification access across ${result.changed} channels`,
    result,
  );
  await interaction.editReply(
    await buildVerificationAdminPanel(interaction.guild),
  );
  return interaction.followUp({
    content: `${KOS.emoji.check} Synchronized access across **${result.changed}** channels.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleClearSetting(
  interaction: ButtonInteraction<"cached">,
  args: string[],
) {
  const target = args[0] ?? "";
  await interaction.deferUpdate();
  if (target === "code_roles") {
    const code = await setVerificationCodeRoles({
      id: args[1] ?? "",
      guildId: interaction.guildId,
      roleIds: [],
    });
    await auditSettings(
      interaction,
      "VERIFICATION_CODE_ROLES_UPDATE",
      `Cleared role grants for code ${code.code}`,
      { codeId: code.id, roleIds: [] },
    );
    return interaction.editReply({
      embeds: [
        {
          color: KOS.colors.success,
          title: `${KOS.emoji.check} Code ${code.code} Saved`,
          description:
            "This code grants the server's default verified role(s) only.",
          footer: { text: KOS.footer },
        },
      ],
      components: [],
    });
  }

  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  if (target === "rules") {
    await updateVerificationSettings(interaction.guildId, {
      rulesChannelId: null,
      requireRulesAcceptance: false,
    });
  } else if (target === "log") {
    await updateVerificationSettings(interaction.guildId, {
      logChannelId: null,
    });
  } else if (target === "allowed") {
    await updateVerificationSettings(interaction.guildId, {
      allowedChannelIds: { set: [] },
    });
  } else if (target === "defaults") {
    await updateVerificationSettings(interaction.guildId, {
      defaultRoleIds: { set: [] },
    });
  } else {
    return interaction.followUp({
      content: "Unknown setting.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (settings.enabled && ["rules", "allowed"].includes(target)) {
    await syncVerificationChannelAccess(interaction.guild);
  }
  await auditSettings(
    interaction,
    "VERIFICATION_SETTING_CLEAR",
    `Cleared verification setting ${target}`,
    { target },
  );
  const updated = await getOrCreateVerificationSettings(interaction.guildId);
  return interaction.editReply(
    target === "defaults"
      ? buildVerificationRolesPanel(updated)
      : buildVerificationChannelsPanel(updated),
  );
}

async function handleCodeDelete(
  interaction: ButtonInteraction<"cached">,
  codeId: string,
) {
  await interaction.deferUpdate();
  const code = await deleteVerificationCode({
    id: codeId,
    guildId: interaction.guildId,
  });
  await auditSettings(
    interaction,
    "VERIFICATION_CODE_DELETE",
    `Deleted verification code ${code.code}`,
    { codeId: code.id, code: code.code },
  );
  return interaction.editReply({
    content: `${KOS.emoji.check} Deleted verification code **${code.code}**. Historical logs were preserved.`,
    embeds: [],
    components: [],
  });
}

async function requireVerificationManager(
  interaction: ButtonInteraction,
): Promise<boolean> {
  if (await isKOSManager(interaction)) return true;
  await interaction.reply({
    content: "You do not have permission to manage KOS verification.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function auditSettings(
  interaction: ButtonInteraction<"cached">,
  action: string,
  message: string,
  metadata?: Prisma.InputJsonObject,
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

async function respondAdminError(
  interaction: ButtonInteraction,
  error: unknown,
) {
  const description =
    error instanceof VerificationSettingsError && error.issues.length
      ? `${error.message}\n${error.issues.map((issue) => `• ${issue}`).join("\n")}`
      : error instanceof Error
        ? error.message
        : "Could not update verification settings.";
  const payload = {
    content: `${KOS.emoji.cross} ${description}`,
    flags: MessageFlags.Ephemeral as const,
  };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}
