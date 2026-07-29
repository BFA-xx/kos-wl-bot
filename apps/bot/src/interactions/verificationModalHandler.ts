import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { LogCategory } from "@kos/db";
import { Actions } from "../utils/ids.js";
import { isKOSManager } from "../utils/permissions.js";
import {
  beginVerification,
  finalizeVerification,
} from "../services/verificationService.js";
import {
  buildVerificationOutcomeMessage,
  buildVerificationRulesMessage,
} from "../embeds/verificationEmbed.js";
import {
  getOrCreateVerificationSettings,
  refreshPublishedVerificationPanel,
  updateVerificationSettings,
} from "../services/verificationSettingsService.js";
import {
  createVerificationCode,
  parseVerificationCodeState,
  parseVerificationExpiration,
  parseVerificationMaxUses,
  updateVerificationCode,
} from "../services/verificationCodeService.js";
import {
  buildVerificationAdminPanel,
  buildVerificationCodeRolesPrompt,
} from "./verificationAdmin.js";
import { audit } from "../services/auditService.js";
import { logVerification } from "../services/verificationLogger.js";
import { KOS } from "../theme.js";

const VERIFICATION_MODAL_ACTIONS = new Set<string>([
  Actions.VerificationSubmitCode,
  Actions.VerificationSaveWelcome,
  Actions.VerificationSaveModal,
  Actions.VerificationSaveMessages,
  Actions.VerificationCodeCreate,
  Actions.VerificationCodeEdit,
]);

export function isVerificationModalAction(action: string): boolean {
  return VERIFICATION_MODAL_ACTIONS.has(action);
}

export async function handleVerificationModal(
  interaction: ModalSubmitInteraction,
  action: string,
  args: string[],
): Promise<unknown> {
  if (action === Actions.VerificationSubmitCode) {
    return handleMemberCodeSubmit(interaction);
  }
  if (!(await requireVerificationManager(interaction))) return;
  if (!interaction.inCachedGuild()) return;

  try {
    if (
      action === Actions.VerificationCodeCreate ||
      action === Actions.VerificationCodeEdit
    ) {
      return await handleCodeSave(interaction, action, args[0]);
    }
    return await handleSettingsSave(interaction, action);
  } catch (error) {
    const content = `${KOS.emoji.cross} ${
      error instanceof Error
        ? error.message
        : "Could not save verification settings."
    }`;
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleMemberCodeSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({
      content: "Verification can only be completed inside the server.",
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await getOrCreateVerificationSettings(interaction.guildId);
  try {
    const flow = await beginVerification({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      codeValue: interaction.fields.getTextInputValue("verification_code"),
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
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (!member) {
      throw new Error("KOS could not confirm your server membership.");
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
    const reason =
      error instanceof Error
        ? error.message
        : "Verification code validation failed.";
    await logVerification({
      client: interaction.client,
      guild: interaction.guild,
      userId: interaction.user.id,
      success: false,
      reason,
    });
    return interaction.editReply(
      buildVerificationOutcomeMessage({
        success: false,
        message: settings.failureMessage,
      }),
    );
  }
}

async function handleSettingsSave(
  interaction: ModalSubmitInteraction<"cached">,
  action: string,
) {
  await interaction.deferUpdate();
  if (action === Actions.VerificationSaveWelcome) {
    await updateVerificationSettings(interaction.guildId, {
      welcomeTitle: requiredField(interaction, "welcome_title", 256),
      welcomeDescription: requiredField(
        interaction,
        "welcome_description",
        4000,
      ),
      verifyButtonLabel: requiredField(interaction, "button_label", 80),
      verifyButtonEmoji:
        interaction.fields.getTextInputValue("button_emoji").trim() || null,
      welcomeColor: parseColor(
        interaction.fields.getTextInputValue("welcome_color"),
      ),
    });
    await recordAdminChange(
      interaction,
      "VERIFICATION_WELCOME_UPDATE",
      "Updated verification welcome embed",
    );
  } else if (action === Actions.VerificationSaveModal) {
    await updateVerificationSettings(interaction.guildId, {
      modalTitle: requiredField(interaction, "modal_title", 45),
      modalFieldLabel: requiredField(interaction, "field_label", 45),
      modalPlaceholder: requiredField(interaction, "placeholder", 100),
    });
    await recordAdminChange(
      interaction,
      "VERIFICATION_MODAL_UPDATE",
      "Updated verification modal",
    );
  } else if (action === Actions.VerificationSaveMessages) {
    await updateVerificationSettings(interaction.guildId, {
      successMessage: requiredField(interaction, "success_message", 2000),
      failureMessage: requiredField(interaction, "failure_message", 2000),
    });
    await recordAdminChange(
      interaction,
      "VERIFICATION_MESSAGES_UPDATE",
      "Updated verification success and failure messages",
    );
  } else {
    throw new Error("Unknown verification settings form.");
  }

  await refreshPublishedVerificationPanel(
    interaction.client,
    interaction.guildId,
  ).catch(() => undefined);
  await interaction.editReply(
    await buildVerificationAdminPanel(interaction.guild),
  );
  return interaction.followUp({
    content: `${KOS.emoji.check} Verification settings saved.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCodeSave(
  interaction: ModalSubmitInteraction<"cached">,
  action: string,
  codeId?: string,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const state = parseVerificationCodeState(
      interaction.fields.getTextInputValue("state"),
    );
    const input = {
      guildId: interaction.guildId,
      code: interaction.fields.getTextInputValue("code"),
      description:
        interaction.fields.getTextInputValue("description").trim() || null,
      maxUses: parseVerificationMaxUses(
        interaction.fields.getTextInputValue("max_uses"),
      ),
      expiresAt: parseVerificationExpiration(
        interaction.fields.getTextInputValue("expires_at"),
      ),
      active: state.active,
      oneTimePerMember: state.oneTimePerMember,
    };
    const code =
      action === Actions.VerificationCodeCreate
        ? await createVerificationCode({
            ...input,
            actorId: interaction.user.id,
          })
        : await updateVerificationCode(codeId ?? "", input);
    await audit({
      guildId: interaction.guildId,
      category: LogCategory.VERIFICATION,
      action:
        action === Actions.VerificationCodeCreate
          ? "VERIFICATION_CODE_CREATE"
          : "VERIFICATION_CODE_EDIT",
      message: `${action === Actions.VerificationCodeCreate ? "Created" : "Updated"} verification code ${code.code}`,
      actorId: interaction.user.id,
      metadata: {
        codeId: code.id,
        code: code.code,
        maxUses: code.maxUses,
        expiresAt: code.expiresAt?.toISOString() ?? null,
        active: code.active,
      },
    });
    return interaction.editReply(buildVerificationCodeRolesPrompt(code));
  } catch (error) {
    return interaction.editReply(
      `${KOS.emoji.cross} ${error instanceof Error ? error.message : "Could not save verification code."}`,
    );
  }
}

async function requireVerificationManager(
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  if (await isKOSManager(interaction)) return true;
  await interaction.reply({
    content: "You do not have permission to manage KOS verification.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function requiredField(
  interaction: ModalSubmitInteraction,
  customId: string,
  maxLength: number,
): string {
  const value = interaction.fields.getTextInputValue(customId).trim();
  if (!value) throw new Error("Required fields cannot be empty.");
  return value.slice(0, maxLength);
}

export function parseColor(value: string): number {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(
      "Embed colour must be a six-digit hex value such as #C0C0C0.",
    );
  }
  return Number.parseInt(normalized, 16);
}

async function recordAdminChange(
  interaction: ModalSubmitInteraction<"cached">,
  action: string,
  message: string,
) {
  await audit({
    guildId: interaction.guildId,
    category: LogCategory.VERIFICATION,
    action,
    message,
    actorId: interaction.user.id,
  });
}
