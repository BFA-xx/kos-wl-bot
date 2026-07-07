import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma } from "@kos/db";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import { isRaffleManager } from "../utils/permissions.js";
import { orgForGuild, pointsBalance } from "../services/pointsService.js";

export const pointsCommand: Command = {
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("points")
    .setDescription("View and host community points")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("balance")
        .setDescription("View your points balance")
        .addUserOption((o) =>
          o.setName("member").setDescription("Optional member to check"),
        ),
    )
    .addSubcommand((s) =>
      s.setName("leaderboard").setDescription("Show the points leaderboard"),
    )
    .addSubcommand((s) =>
      s.setName("panel").setDescription("[Manager] Post the points hub here"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      return interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
    }
    const org = await orgForGuild(interaction.guildId);
    if (!org) {
      return interaction.reply({
        content: "This server is not connected to a KOS organization yet.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "balance") return balance(interaction, org.id);
    if (sub === "leaderboard") return leaderboard(interaction, org.id, org.name);
    return panel(interaction, org.name);
  },
};

async function balance(interaction: ChatInputCommandInteraction, organizationId: string) {
  const target = interaction.options.getUser("member") ?? interaction.user;
  const points = await pointsBalance(organizationId, target.id);
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} Points balance`)
        .setDescription(`<@${target.id}> has **${points} points**.`)
        .setFooter({ text: KOS.footer }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function leaderboard(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
  orgName: string,
) {
  const rows = await prisma.pointsLedger.groupBy({
    by: ["userId"],
    where: { organizationId },
    _sum: { delta: true },
    orderBy: { _sum: { delta: "desc" } },
    take: 10,
  });
  const body =
    rows.length === 0
      ? "No points yet. Complete tasks to start earning."
      : rows
          .map((r, index) => `**#${index + 1}** <@${r.userId}> — **${r._sum.delta ?? 0} pts**`)
          .join("\n");
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} ${orgName} leaderboard`)
        .setDescription(body)
        .setFooter({ text: KOS.footer }),
    ],
  });
}

async function panel(interaction: ChatInputCommandInteraction, orgName: string) {
  const allowed = await isRaffleManager(interaction);
  if (!allowed) {
    return interaction.reply({ content: "Only raffle managers can post the points hub.", flags: MessageFlags.Ephemeral });
  }
  const guild = await prisma.guild.findUnique({
    where: { id: interaction.guildId! },
    select: { defaultPointsChannelId: true },
  });
  const channelId = guild?.defaultPointsChannelId ?? interaction.channelId;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return interaction.reply({ content: "I can't post in the configured points channel.", flags: MessageFlags.Ephemeral });
  }
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} ${orgName} points hub`)
        .setDescription(
          [
            "Earn points by completing verification tasks.",
            "Standalone tasks are available with `/tasks list` and on the web profile Tasks page.",
            "Spend points in the reward store.",
            "",
            "`/tasks list` — see ways to earn",
            "`/tasks verify` — complete a task",
            "`/points balance` — check your balance",
            "`/rewards list` — see rewards",
            "`/rewards redeem` — claim a reward",
          ].join("\n"),
        )
        .setFooter({ text: KOS.footer }),
    ],
  });
  return interaction.reply({
    content: `${KOS.emoji.check} Points hub posted in <#${channelId}>.`,
    flags: MessageFlags.Ephemeral,
  });
}
