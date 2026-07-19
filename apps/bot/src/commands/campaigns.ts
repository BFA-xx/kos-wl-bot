import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import {
  CampaignStatus,
  campaignProgressSnapshot,
  prisma,
  syncCampaignProgress,
} from "@kos/db";
import type { Command } from "../types.js";
import { config } from "../config.js";
import { KOS } from "../theme.js";
import { notifyPointsChannel, orgForGuild } from "../services/pointsService.js";
import { upsertUser } from "../services/userService.js";

export const campaignsCommand: Command = {
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("campaigns")
    .setDescription("Join and track KOS community campaigns")
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List active community campaigns"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("join")
        .setDescription("Join a live campaign")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign to join")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("progress")
        .setDescription("Check your campaign progress")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Campaign to inspect")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      return interaction.reply({
        content: "Use this command in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const org = await orgForGuild(interaction.guildId);
    if (!org) {
      return interaction.reply({
        content: "This server is not connected to a KOS organization yet.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "list")
      return listCampaigns(interaction, org.id, org.name);
    if (subcommand === "join") return joinCampaign(interaction, org.id);
    return showProgress(interaction, org.id);
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) return interaction.respond([]);
    const org = await orgForGuild(interaction.guildId);
    if (!org) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const subcommand = interaction.options.getSubcommand();
    const campaigns = await prisma.campaign.findMany({
      where: {
        organizationId: org.id,
        status:
          subcommand === "join"
            ? CampaignStatus.LIVE
            : { in: [CampaignStatus.LIVE, CampaignStatus.ENDED] },
        title: { contains: focused, mode: "insensitive" },
        ...(subcommand === "progress"
          ? { enrollments: { some: { userId: interaction.user.id } } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, completionPoints: true },
    });
    return interaction.respond(
      campaigns.map((campaign) => ({
        name: `${campaign.title}${campaign.completionPoints ? ` (+${campaign.completionPoints} pts)` : ""}`.slice(
          0,
          100,
        ),
        value: campaign.id,
      })),
    );
  },
};

async function listCampaigns(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
  organizationName: string,
) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      organizationId,
      status: { in: [CampaignStatus.SCHEDULED, CampaignStatus.LIVE] },
    },
    orderBy: [{ status: "desc" }, { endAt: "asc" }],
    take: 10,
    include: {
      _count: { select: { tasks: true, raffles: true } },
      enrollments: {
        where: { userId: interaction.user.id },
        select: { status: true },
        take: 1,
      },
    },
  });
  const description = campaigns.length
    ? campaigns
        .map((campaign) => {
          const joined = campaign.enrollments[0]?.status;
          const timing =
            campaign.status === CampaignStatus.SCHEDULED
              ? campaign.startAt
                ? `Starts <t:${Math.floor(campaign.startAt.getTime() / 1000)}:R>`
                : "Scheduled"
              : campaign.endAt
                ? `Ends <t:${Math.floor(campaign.endAt.getTime() / 1000)}:R>`
                : "Live now";
          return `**${campaign.title}**\n${timing} · ${campaign._count.tasks + campaign._count.raffles} steps${campaign.completionPoints ? ` · +${campaign.completionPoints} completion points` : ""}${joined ? ` · ${joined.toLowerCase()}` : ""}`;
        })
        .join("\n\n")
    : "No live or scheduled campaigns yet.";
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} ${organizationName} campaigns`)
        .setDescription(description)
        .setFooter({
          text: "Use /campaigns join to start a journey · Powered by KOS",
        }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function joinCampaign(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const campaignId = interaction.options.getString("campaign", true);
  const now = new Date();
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId,
      status: CampaignStatus.LIVE,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gt: now } }] },
      ],
    },
  });
  if (!campaign)
    return interaction.editReply("Campaign not found or not open.");
  const member = await interaction
    .guild!.members.fetch(interaction.user.id)
    .catch(() => null);
  if (!member)
    return interaction.editReply("Could not load your server membership.");
  await upsertUser({
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarUrl: member.user.displayAvatarURL(),
  });
  await prisma.campaignEnrollment.upsert({
    where: { campaignId_userId: { campaignId, userId: member.id } },
    create: { campaignId, userId: member.id },
    update: {},
  });
  const result = await syncCampaignProgress(prisma, campaignId, member.id);
  if (result?.awardedPoints) {
    await notifyPointsChannel({
      organizationId,
      userId: member.id,
      delta: result.awardedPoints,
      reason: `completed campaign ${result.title}`,
    });
  }
  const link = config.DASHBOARD_URL
    ? `\n\nOpen your campaign workspace: ${config.DASHBOARD_URL}/me/campaigns`
    : "";
  return interaction.editReply(
    `${KOS.emoji.check} Joined **${campaign.title}**. ${result?.progress.requiredDone ?? 0}/${result?.progress.requiredTotal ?? 0} required steps are already complete.${link}`,
  );
}

async function showProgress(
  interaction: ChatInputCommandInteraction,
  organizationId: string,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const campaignId = interaction.options.getString("campaign", true);
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId,
      enrollments: { some: { userId: interaction.user.id } },
    },
    include: {
      enrollments: {
        where: { userId: interaction.user.id },
        select: { status: true },
        take: 1,
      },
    },
  });
  if (!campaign) return interaction.editReply("Join this campaign first.");
  const result = await syncCampaignProgress(
    prisma,
    campaign.id,
    interaction.user.id,
  );
  if (result?.awardedPoints) {
    await notifyPointsChannel({
      organizationId,
      userId: interaction.user.id,
      delta: result.awardedPoints,
      reason: `completed campaign ${result.title}`,
    });
  }
  const progress =
    result?.progress ??
    (await campaignProgressSnapshot(prisma, campaign.id, interaction.user.id));
  if (!progress)
    return interaction.editReply("Campaign progress is unavailable.");
  const description = progress.steps
    .map(
      (step) =>
        `${step.done ? KOS.emoji.check : "○"} ${step.title}${step.required ? "" : " · optional"}`,
    )
    .join("\n");
  const complete =
    result?.completedNow ||
    campaign.enrollments[0]?.status === "COMPLETED" ||
    progress.complete;
  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(complete ? KOS.colors.success : KOS.colors.silver)
        .setTitle(
          `${campaign.title} · ${complete ? "Complete" : "In progress"}`,
        )
        .setDescription(description || "No campaign steps are configured.")
        .addFields({
          name: "Progress",
          value: `${progress.requiredDone}/${progress.requiredTotal} required steps${campaign.completionPoints ? ` · ${campaign.completionPoints} completion points` : ""}`,
        })
        .setFooter({
          text: "Campaign progress uses the same KOS task, raffle, and points records.",
        }),
    ],
  });
}
