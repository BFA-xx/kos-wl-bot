import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import {
  addToBlacklist,
  removeFromBlacklist,
  listBlacklist,
} from "../services/blacklistService.js";

export const blacklistCommand: Command = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage the raffle blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Blacklist a user from raffles")
        .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a user from the blacklist")
        .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show blacklisted users"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === "add") {
      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ?? undefined;
      const { created } = await addToBlacklist({
        guildId,
        userId: user.id,
        username: user.username,
        reason,
        actorId: interaction.user.id,
      });
      return interaction.reply({
        content: created
          ? `${KOS.emoji.cross} Blacklisted <@${user.id}>.${reason ? ` Reason: ${reason}` : ""}`
          : `<@${user.id}> is already blacklisted.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "remove") {
      const user = interaction.options.getUser("user", true);
      const { removed } = await removeFromBlacklist({
        guildId,
        userId: user.id,
        actorId: interaction.user.id,
      });
      return interaction.reply({
        content: removed
          ? `${KOS.emoji.check} Removed <@${user.id}> from the blacklist.`
          : `<@${user.id}> is not blacklisted.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // list
    const rows = await listBlacklist(guildId);
    const embed = new EmbedBuilder()
      .setColor(KOS.colors.danger)
      .setTitle(`${KOS.emoji.cross} Blacklist`)
      .setDescription(
        rows.length === 0
          ? "No users are blacklisted."
          : rows
              .map((r) => `• <@${r.userId}>${r.reason ? ` — ${r.reason}` : ""}`)
              .join("\n")
              .slice(0, 4000),
      )
      .setFooter({ text: KOS.footer });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
