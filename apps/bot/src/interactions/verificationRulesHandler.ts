import { MessageFlags, type ButtonInteraction } from "discord.js";
import { buildVerificationOutcomeMessage } from "../embeds/verificationEmbed.js";
import { finalizeVerification } from "../services/verificationService.js";

/** Complete the member flow only after the explicit Discord-native agreement. */
export async function handleVerificationRulesAcceptance(
  interaction: ButtonInteraction,
  attemptId: string,
): Promise<unknown> {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({
      content: "Rules can only be accepted inside the server.",
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.update({
    content: "Completing your verification…",
    embeds: [],
    components: [],
  });
  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  if (!member) {
    return interaction.editReply(
      buildVerificationOutcomeMessage({
        success: false,
        message:
          "KOS could not confirm your server membership. Please try again.",
      }),
    );
  }
  const result = await finalizeVerification({
    member,
    attemptId,
    acceptRules: true,
  });
  return interaction.editReply(
    buildVerificationOutcomeMessage({
      success: result.success,
      message: result.message,
    }),
  );
}
