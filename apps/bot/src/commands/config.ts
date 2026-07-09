import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma, LogCategory } from "@kos/db";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import { ensureGuild } from "../services/userService.js";
import { audit } from "../services/auditService.js";

export const configCommand: Command = {
  // Admin-only; we verify explicitly below in addition to the Discord gate.
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure KOS WL Bot for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommandGroup((g) =>
      g
        .setName("managers")
        .setDescription("Roles allowed to run /raffle and /blacklist")
        .addSubcommand((s) =>
          s
            .setName("add")
            .setDescription("Allow a role to manage raffles")
            .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName("remove")
            .setDescription("Revoke a manager role")
            .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
        )
        .addSubcommand((s) => s.setName("list").setDescription("List manager roles")),
    )
    .addSubcommand((s) =>
      s
        .setName("channels")
        .setDescription("Set default raffle / winner / proof channels")
        .addChannelOption((o) =>
          o
            .setName("raffle")
            .setDescription("Default channel for new raffle posts")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o
            .setName("announce")
            .setDescription("Default winner announcement channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o
            .setName("proof")
            .setDescription("Default proof delivery channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o
            .setName("points")
            .setDescription("Points, rewards, and leaderboard channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((s) => s.setName("show").setDescription("Show current configuration")),

  async execute(interaction: ChatInputCommandInteraction) {
    const isAdmin =
      interaction.guild?.ownerId === interaction.user.id ||
      Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    if (!isAdmin) {
      return interaction.reply({
        content: "Only server administrators can change configuration.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const guildId = interaction.guildId!;
    await ensureGuild({ id: guildId, name: interaction.guild?.name ?? null });

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === "managers") {
      if (sub === "add") return addManager(interaction, guildId);
      if (sub === "remove") return removeManager(interaction, guildId);
      return listManagers(interaction, guildId);
    }
    if (sub === "channels") return setChannels(interaction, guildId);
    return showConfig(interaction, guildId);
  },
};

async function addManager(interaction: ChatInputCommandInteraction, guildId: string) {
  const role = interaction.options.getRole("role", true);
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
  if (guild.managerRoleIds.includes(role.id)) {
    return interaction.reply({ content: `<@&${role.id}> is already a manager role.`, flags: MessageFlags.Ephemeral });
  }
  await prisma.guild.update({
    where: { id: guildId },
    data: { managerRoleIds: { set: [...guild.managerRoleIds, role.id] } },
  });
  await audit({
    guildId,
    category: LogCategory.ADMIN,
    action: "CONFIG_MANAGER_ADD",
    message: `Added manager role ${role.name}`,
    actorId: interaction.user.id,
  });
  return interaction.reply({
    content: `${KOS.emoji.check} <@&${role.id}> can now manage raffles.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function removeManager(interaction: ChatInputCommandInteraction, guildId: string) {
  const role = interaction.options.getRole("role", true);
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
  await prisma.guild.update({
    where: { id: guildId },
    data: { managerRoleIds: { set: guild.managerRoleIds.filter((r) => r !== role.id) } },
  });
  await audit({
    guildId,
    category: LogCategory.ADMIN,
    action: "CONFIG_MANAGER_REMOVE",
    message: `Removed manager role ${role.name}`,
    actorId: interaction.user.id,
  });
  return interaction.reply({
    content: `${KOS.emoji.check} <@&${role.id}> can no longer manage raffles.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function listManagers(interaction: ChatInputCommandInteraction, guildId: string) {
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
  return interaction.reply({
    content:
      guild.managerRoleIds.length === 0
        ? "No manager roles set. Admins / Manage Server can still manage raffles."
        : `Manager roles: ${guild.managerRoleIds.map((r) => `<@&${r}>`).join(", ")}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function setChannels(interaction: ChatInputCommandInteraction, guildId: string) {
  const raffle = interaction.options.getChannel("raffle");
  const announce = interaction.options.getChannel("announce");
  const proof = interaction.options.getChannel("proof");
  const points = interaction.options.getChannel("points");
  if (!raffle && !announce && !proof && !points) {
    return interaction.reply({ content: "Provide a raffle, announce, proof, and/or points channel.", flags: MessageFlags.Ephemeral });
  }
  await prisma.guild.update({
    where: { id: guildId },
    data: {
      ...(raffle ? { defaultRaffleChannelId: raffle.id } : {}),
      ...(announce ? { defaultAnnounceChannelId: announce.id } : {}),
      ...(proof ? { defaultProofChannelId: proof.id } : {}),
      ...(points ? { defaultPointsChannelId: points.id } : {}),
    },
  });
  return interaction.reply({
    content: `${KOS.emoji.check} Updated default channels.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function showConfig(interaction: ChatInputCommandInteraction, guildId: string) {
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId } });
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Server Configuration`)
    .addFields(
      {
        name: "Manager Roles",
        value: guild.managerRoleIds.length
          ? guild.managerRoleIds.map((r) => `<@&${r}>`).join(", ")
          : "Admins / Manage Server only",
      },
      {
        name: "Default Raffle Channel",
        value: guild.defaultRaffleChannelId ? `<#${guild.defaultRaffleChannelId}>` : "—",
        inline: true,
      },
      {
        name: "Default Announce Channel",
        value: guild.defaultAnnounceChannelId ? `<#${guild.defaultAnnounceChannelId}>` : "—",
        inline: true,
      },
      {
        name: "Default Proof Channel",
        value: guild.defaultProofChannelId ? `<#${guild.defaultProofChannelId}>` : "—",
        inline: true,
      },
      {
        name: "Points Channel",
        value: guild.defaultPointsChannelId ? `<#${guild.defaultPointsChannelId}>` : "—",
        inline: true,
      },
    )
    .setFooter({ text: KOS.footer });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
