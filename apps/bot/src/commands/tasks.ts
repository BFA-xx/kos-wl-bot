import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma } from "@kos/db";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import {
  orgForGuild,
  TASK_TYPE_LABELS,
  taskActionUrl,
  verifyTaskForMember,
  type TaskConfig,
} from "../services/pointsService.js";
import { config } from "../config.js";

export const tasksCommand: Command = {
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("Complete KOS tasks and earn points")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName("list").setDescription("List active tasks for this community"),
    )
    .addSubcommand((s) =>
      s
        .setName("verify")
        .setDescription("Verify a task and earn points")
        .addStringOption((o) =>
          o
            .setName("task")
            .setDescription("Task to verify")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName("evidence")
            .setDescription("Optional note/proof for manual-review tasks"),
        ),
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
    if (interaction.options.getSubcommand() === "list") return listTasks(interaction, org.id, org.name);
    return verify(interaction, org.id);
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) return interaction.respond([]);
    const org = await orgForGuild(interaction.guildId);
    if (!org) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const tasks = await prisma.taskDefinition.findMany({
      where: {
        organizationId: org.id,
        active: true,
        title: { contains: focused, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, points: true },
    });
    return interaction.respond(
      tasks.map((t) => ({
        name: `${t.title}${t.points > 0 ? ` (+${t.points} pts)` : ""}`.slice(0, 100),
        value: t.id,
      })),
    );
  },
};

async function listTasks(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
  orgName: string,
) {
  const tasks = await prisma.taskDefinition.findMany({
    where: { organizationId, active: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  const description =
    tasks.length === 0
      ? "No active tasks yet."
      : tasks
          .map((task) => {
            const cfg = (task.config ?? {}) as TaskConfig;
            const url = taskActionUrl(task.type, cfg);
            return [
              `**${task.title}**`,
              `${TASK_TYPE_LABELS[task.type]}${task.points > 0 ? ` · +${task.points} pts` : ""}`,
              url ? `<${url}>` : null,
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n");
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} ${orgName} tasks`)
        .setDescription(description)
        .setFooter({
          text: "Use /tasks verify to complete a task · Powered by KOS",
        }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function verify(interaction: ChatInputCommandInteraction, organizationId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const taskId = interaction.options.getString("task", true);
  const task = await prisma.taskDefinition.findFirst({
    where: { id: taskId, organizationId, active: true },
  });
  if (!task) return interaction.editReply("Task not found or disabled.");
  const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply("Could not verify your server membership.");

  const result = await verifyTaskForMember({
    task,
    member,
    evidenceNote: interaction.options.getString("evidence"),
  });
  const webLink = config.DASHBOARD_URL ? `\n\nWeb profile: ${config.DASHBOARD_URL}/me/points` : "";
  if (result.status === "VERIFIED") {
    return interaction.editReply(
      `${KOS.emoji.check} **${task.title}** verified.${task.points > 0 ? ` You earned **+${task.points} points**.` : ""}`,
    );
  }
  if (result.status === "NEEDS_REVIEW") {
    return interaction.editReply(`${KOS.emoji.check} ${result.reason}${webLink}`);
  }
  return interaction.editReply(`${KOS.emoji.cross} ${result.reason}${webLink}`);
}
