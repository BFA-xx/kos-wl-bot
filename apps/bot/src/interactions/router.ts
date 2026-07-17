import {
  MessageFlags,
  type Interaction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commandMap } from "../commands/index.js";
import { isRaffleManager } from "../utils/permissions.js";
import { handleButton } from "./buttons.js";
import { handleModal } from "./modals.js";
import { handleRaffleSelect } from "./raffleWizard.js";
import { logger } from "../logger.js";

/** Single entry point for every interaction the bot receives. */
export async function handleInteraction(
  interaction: Interaction,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      return await runCommand(interaction);
    }
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (
      interaction.isChannelSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isStringSelectMenu()
    ) {
      await handleRaffleSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }
  } catch (err) {
    logger.error(
      {
        err,
        type: interaction.type,
        interactionId: interaction.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        commandName: interaction.isCommand()
          ? interaction.commandName
          : undefined,
        customId:
          interaction.isMessageComponent() || interaction.isModalSubmit()
            ? interaction.customId
            : undefined,
      },
      "interaction handler error",
    );
    await safeError(interaction);
  }
}

async function runCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({
      content: "Unknown command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (command.managerOnly) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const allowed = await isRaffleManager(interaction);
    if (!allowed) {
      await interaction.reply({
        content:
          "You don't have permission to manage raffles. Ask an admin to grant you a manager role.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await command.execute(interaction);
}

async function safeError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = {
    content: "An unexpected error occurred. The team has been notified.",
    flags: MessageFlags.Ephemeral as const,
  };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    /* swallow — nothing more we can do */
  }
}
