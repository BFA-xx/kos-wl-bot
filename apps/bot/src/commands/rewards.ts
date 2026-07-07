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
import { isRaffleManager } from "../utils/permissions.js";
import {
  orgForGuild,
  pointsBalance,
  redeemReward,
  updateRedemptionStatus,
} from "../services/pointsService.js";

export const rewardsCommand: Command = {
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("Use KOS points rewards")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName("list").setDescription("List available rewards"),
    )
    .addSubcommand((s) =>
      s
        .setName("redeem")
        .setDescription("Redeem a reward with points")
        .addStringOption((o) =>
          o
            .setName("reward")
            .setDescription("Reward to redeem")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("mine").setDescription("View your reward redemptions"),
    )
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("[Manager] Create a reward")
        .addStringOption((o) =>
          o.setName("title").setDescription("Reward title").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("cost")
            .setDescription("Point cost")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("Reward details"),
        )
        .addIntegerOption((o) =>
          o
            .setName("stock")
            .setDescription("Optional stock remaining")
            .setMinValue(0),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("fulfill")
        .setDescription("[Manager] Mark a redemption fulfilled")
        .addStringOption((o) =>
          o.setName("redemption").setDescription("Redemption id").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("[Manager] Cancel and refund a pending redemption")
        .addStringOption((o) =>
          o.setName("redemption").setDescription("Redemption id").setRequired(true),
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

    const sub = interaction.options.getSubcommand();
    if (sub === "list") return list(interaction, org.id, org.name);
    if (sub === "redeem") return redeem(interaction);
    if (sub === "mine") return mine(interaction, org.id);
    if (sub === "create") return create(interaction, org.id);
    if (sub === "fulfill") return closeRedemption(interaction, "FULFILLED");
    return closeRedemption(interaction, "CANCELLED");
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) return interaction.respond([]);
    const org = await orgForGuild(interaction.guildId);
    if (!org) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const rewards = await prisma.reward.findMany({
      where: {
        organizationId: org.id,
        active: true,
        title: { contains: focused, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, cost: true, stock: true },
    });
    return interaction.respond(
      rewards.map((r) => ({
        name: `${r.title} (${r.cost} pts${r.stock !== null ? ` · ${r.stock} left` : ""})`.slice(0, 100),
        value: r.id,
      })),
    );
  },
};

async function list(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
  orgName: string,
) {
  const [rewards, balance] = await Promise.all([
    prisma.reward.findMany({
      where: { organizationId, active: true },
      orderBy: [{ cost: "asc" }, { createdAt: "desc" }],
      take: 15,
    }),
    pointsBalance(organizationId, interaction.user.id),
  ]);
  const body =
    rewards.length === 0
      ? "No active rewards yet."
      : rewards
          .map((r) => {
            const stock = r.stock === null ? "unlimited" : `${r.stock} left`;
            return `**${r.title}** — **${r.cost} pts** · ${stock}${r.description ? `\n${r.description}` : ""}`;
          })
          .join("\n\n");
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.trophy} ${orgName} rewards`)
        .setDescription(body)
        .addFields({ name: "Your balance", value: `${balance} points`, inline: true })
        .setFooter({ text: "Use /rewards redeem to claim · Powered by KOS" }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function redeem(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rewardId = interaction.options.getString("reward", true);
  const member = await interaction.guild!.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply("Could not verify your server membership.");
  const result = await redeemReward({ rewardId, member });
  if (!result.ok) return interaction.editReply(`${KOS.emoji.cross} ${result.error}`);
  return interaction.editReply(
    `${KOS.emoji.check} Redeemed **${result.title}** for **${result.cost} points**.\nRedemption id: \`${result.redemptionId}\`\nA team member will fulfill it soon.`,
  );
}

async function mine(interaction: ChatInputCommandInteraction, organizationId: string) {
  const rows = await prisma.rewardRedemption.findMany({
    where: { organizationId, userId: interaction.user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { reward: { select: { title: true } } },
  });
  const body =
    rows.length === 0
      ? "You have not redeemed any rewards yet."
      : rows
          .map((r) => `\`${r.id}\` — **${r.reward.title}** · ${r.cost} pts · ${r.status}`)
          .join("\n");
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.trophy} My rewards`)
        .setDescription(body)
        .setFooter({ text: KOS.footer }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function create(interaction: ChatInputCommandInteraction, organizationId: string) {
  const allowed = await isRaffleManager(interaction);
  if (!allowed) {
    return interaction.reply({ content: "Only raffle managers can create rewards.", flags: MessageFlags.Ephemeral });
  }
  const title = interaction.options.getString("title", true).trim();
  const description = interaction.options.getString("description")?.trim() || null;
  const cost = interaction.options.getInteger("cost", true);
  const stock = interaction.options.getInteger("stock");
  const reward = await prisma.reward.create({
    data: {
      organizationId,
      title,
      description,
      cost,
      stock,
      createdById: interaction.user.id,
    },
  });
  return interaction.reply({
    content: `${KOS.emoji.check} Created reward **${reward.title}** for **${reward.cost} points**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function closeRedemption(
  interaction: ChatInputCommandInteraction,
  status: "FULFILLED" | "CANCELLED",
) {
  const allowed = await isRaffleManager(interaction);
  if (!allowed) {
    return interaction.reply({ content: "Only raffle managers can update rewards.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const redemptionId = interaction.options.getString("redemption", true);
  const result = await updateRedemptionStatus({
    redemptionId,
    guildId: interaction.guildId!,
    actorId: interaction.user.id,
    status,
  });
  if (!result.ok) return interaction.editReply(`${KOS.emoji.cross} ${result.error}`);
  return interaction.editReply(
    `${KOS.emoji.check} Redemption \`${redemptionId}\` marked **${status.toLowerCase()}**.`,
  );
}
