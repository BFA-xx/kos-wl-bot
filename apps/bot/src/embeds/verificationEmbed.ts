import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
} from "discord.js";
import type { VerificationSettings } from "@kos/db";
import { KOS } from "../theme.js";
import { Actions, buildId } from "../utils/ids.js";

export function buildVerificationWelcomeMessage(
  settings: VerificationSettings,
): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(safeColor(settings.welcomeColor))
    .setTitle(settings.welcomeTitle.slice(0, 256))
    .setDescription(settings.welcomeDescription.slice(0, 4096))
    .setFooter({ text: KOS.footer });
  if (KOS.logoUrl) embed.setThumbnail(KOS.logoUrl);

  const button = new ButtonBuilder()
    .setCustomId(buildId(Actions.VerificationStart))
    .setStyle(ButtonStyle.Primary)
    .setLabel(settings.verifyButtonLabel.slice(0, 80));
  if (settings.verifyButtonEmoji) {
    try {
      button.setEmoji(settings.verifyButtonEmoji);
    } catch {
      // Keep a usable button if an old/custom emoji is no longer available.
    }
  }
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    allowedMentions: { parse: [] },
  };
}

export function buildVerificationRulesMessage(input: {
  settings: VerificationSettings;
  attemptId: string;
  guildId: string;
}): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Server Rules`)
    .setDescription(
      "Please read our server rules before continuing.\n\nOnly click **I Agree** after you have reviewed them.",
    )
    .setFooter({ text: KOS.footer });
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (input.settings.rulesChannelId) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("View Rules")
        .setURL(
          `https://discord.com/channels/${input.guildId}/${input.settings.rulesChannelId}`,
        ),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(Actions.VerificationAgreeRules, input.attemptId))
      .setStyle(ButtonStyle.Success)
      .setLabel("I Agree"),
  );
  return { embeds: [embed], components: [row] };
}

export function buildVerificationOutcomeMessage(input: {
  success: boolean;
  message: string;
}): BaseMessageOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(input.success ? KOS.colors.success : KOS.colors.danger)
        .setTitle(
          input.success
            ? `${KOS.emoji.check} Verification Complete`
            : `${KOS.emoji.cross} Verification Unsuccessful`,
        )
        .setDescription(input.message.slice(0, 4096))
        .setFooter({ text: KOS.footer }),
    ],
    components: [],
  };
}

function safeColor(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff
    ? value
    : KOS.colors.silver;
}
