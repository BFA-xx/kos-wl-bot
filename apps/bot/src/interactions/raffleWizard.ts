import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ButtonInteraction,
} from "discord.js";
import { prisma, RoleMatchMode, WalletChain } from "@kos/db";
import { buildId, parseId, Actions } from "../utils/ids.js";
import { stashPending, getPending, takePending, type PendingRaffle } from "../services/pendingRaffles.js";
import { createRaffle, publishRaffleMessage } from "../services/raffleService.js";
import { resolveWhen, resolveTime, discordRelative } from "../utils/time.js";
import { KOS } from "../theme.js";
import { logger } from "../logger.js";

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

/** Step 1 → 2: modal submitted; validate text, create a draft, show the panel. */
export async function handleRaffleCreateModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Raffles can only be created in a server.", flags: MessageFlags.Ephemeral });
  }

  const projectName = interaction.fields.getTextInputValue("project").trim();
  const title = interaction.fields.getTextInputValue("title").trim();
  const spotsRaw = interaction.fields.getTextInputValue("spots").trim();
  const startStr = interaction.fields.getTextInputValue("start").trim();
  const endStr = interaction.fields.getTextInputValue("end");

  const spots = Number.parseInt(spotsRaw, 10);
  if (!Number.isFinite(spots) || spots < 1 || spots > 10000) {
    return interaction.reply({ content: "WL spots must be a number between 1 and 10000.", flags: MessageFlags.Ephemeral });
  }

  const now = new Date();
  const startAt = startStr ? resolveWhen(startStr, now) : now;
  if (!startAt) {
    return interaction.reply({
      content: "Couldn't read the start. Use `now`, or `2026-06-25 17:00`.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const endAt = resolveTime(endStr, startAt);
  if (!endAt) {
    return interaction.reply({ content: "Couldn't read the end. Try `24h`, `2d`, or `2026-06-26 17:00`.", flags: MessageFlags.Ephemeral });
  }
  if (endAt.getTime() <= startAt.getTime()) {
    return interaction.reply({ content: "End must be after the start.", flags: MessageFlags.Ephemeral });
  }
  if (endAt.getTime() <= now.getTime()) {
    return interaction.reply({ content: "End must be in the future.", flags: MessageFlags.Ephemeral });
  }

  const guild = await prisma.guild.findUnique({
    where: { id: interaction.guildId! },
    select: { defaultAnnounceChannelId: true, defaultProofChannelId: true },
  });

  const nonce = stashPending({
    guildId: interaction.guildId!,
    createdById: interaction.user.id,
    projectName,
    title,
    spots,
    startAt,
    endAt,
    postChannelId: interaction.channelId ?? null,
    announceChannelId: guild?.defaultAnnounceChannelId ?? null,
    proofChannelId: guild?.defaultProofChannelId ?? null,
    roles: [],
    roleMatchMode: RoleMatchMode.ANY,
    walletChains: [WalletChain.ETHEREUM],
    collectWallets: true,
    requirements: null,
    bannerUrl: null,
    externalUrl: null,
  });

  const draft = getPending(nonce)!;
  return interaction.reply({ ...buildPanel(nonce, draft), flags: MessageFlags.Ephemeral });
}

/** Channel/role select changed. */
export async function handleRaffleSelect(
  interaction: ChannelSelectMenuInteraction | RoleSelectMenuInteraction,
) {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;
  const nonce = parsed.args[0] ?? "";
  const draft = getPending(nonce);
  if (!draft) return expired(interaction);

  switch (parsed.action) {
    case Actions.RaffleSetPost:
      draft.postChannelId = interaction.values[0] ?? draft.postChannelId;
      break;
    case Actions.RaffleSetAnnounce:
      draft.announceChannelId = interaction.values[0] ?? null;
      break;
    case Actions.RaffleSetProof:
      draft.proofChannelId = interaction.values[0] ?? null;
      break;
    case Actions.RaffleSetRoles: {
      const roleInteraction = interaction as RoleSelectMenuInteraction;
      draft.roles = [...roleInteraction.roles.values()]
        .filter((r) => r.id !== interaction.guildId)
        .map((r) => ({ roleId: r.id, roleName: r.name }));
      break;
    }
    default:
      return;
  }
  return interaction.update(buildPanel(nonce, draft));
}

/** Match-toggle / Publish / Cancel buttons. */
export async function handleRaffleWizardButton(interaction: ButtonInteraction) {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;
  const nonce = parsed.args[0] ?? "";

  if (parsed.action === Actions.RaffleCancel) {
    takePending(nonce);
    return interaction.update({ content: "Raffle setup cancelled.", embeds: [], components: [] });
  }

  const draft = getPending(nonce);
  if (!draft) return expired(interaction);

  if (parsed.action === Actions.RaffleToggleMatch) {
    draft.roleMatchMode =
      draft.roleMatchMode === RoleMatchMode.ALL ? RoleMatchMode.ANY : RoleMatchMode.ALL;
    return interaction.update(buildPanel(nonce, draft));
  }

  if (parsed.action === Actions.RafflePublish) {
    return publish(interaction, nonce, draft);
  }
}

async function publish(interaction: ButtonInteraction, nonce: string, draft: PendingRaffle) {
  if (!draft.postChannelId) {
    return interaction.reply({ content: "Pick a channel to post the raffle in first.", flags: MessageFlags.Ephemeral });
  }

  await interaction.update({ content: "Creating raffle…", embeds: [], components: [] });
  takePending(nonce);

  try {
    const raffle = await createRaffle({
      guildId: draft.guildId,
      createdById: draft.createdById,
      projectName: draft.projectName,
      title: draft.title,
      spots: draft.spots,
      roleMatchMode: draft.roleMatchMode,
      startAt: draft.startAt,
      endAt: draft.endAt,
      channelId: draft.postChannelId,
      announceChannelId: draft.announceChannelId ?? draft.postChannelId,
      proofChannelId: draft.proofChannelId ?? draft.postChannelId,
      bannerUrl: draft.bannerUrl,
      externalUrl: draft.externalUrl,
      requirements: draft.requirements,
      collectWallets: draft.collectWallets,
      walletChains: draft.walletChains,
      roles: draft.roles,
    });

    const result = await publishRaffleMessage(interaction.client, raffle.id);

    const header = result.ok
      ? `${KOS.emoji.check} **Raffle #${raffle.id}** is live in <#${draft.postChannelId}>.`
      : `⚠️ Raffle #${raffle.id} was created, but I couldn't post it: ${result.reason}\n` +
        `Fix that, then run \`/raffle repost id:${raffle.id}\`.`;

    return interaction.editReply({
      content: [
        header,
        `Status: **${raffle.status}** · Starts ${discordRelative(draft.startAt)} · Ends ${discordRelative(draft.endAt)}`,
        `Winners announced in <#${draft.announceChannelId ?? draft.postChannelId}>.`,
      ].join("\n"),
    });
  } catch (err) {
    logger.error({ err }, "raffle publish failed");
    return interaction.editReply({ content: "Something went wrong creating the raffle. Please try again." });
  }
}

function buildPanel(nonce: string, draft: PendingRaffle) {
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Raffle Setup`)
    .setDescription(
      [
        `**${draft.projectName}** — ${draft.title}`,
        `${KOS.emoji.spot} Spots: **${draft.spots}**`,
        `Starts ${discordRelative(draft.startAt)} · Ends ${discordRelative(draft.endAt)}`,
        "",
        "Pick where to post it and who can enter, then **Publish**.",
      ].join("\n"),
    )
    .addFields(
      { name: "Post in", value: draft.postChannelId ? `<#${draft.postChannelId}>` : "_choose below_", inline: true },
      { name: "Announce", value: draft.announceChannelId ? `<#${draft.announceChannelId}>` : "_= post channel_", inline: true },
      { name: "Proof", value: draft.proofChannelId ? `<#${draft.proofChannelId}>` : "_= post channel_", inline: true },
      {
        name: "Eligible roles",
        value: draft.roles.length ? draft.roles.map((r) => `<@&${r.roleId}>`).join(" ") : "Everyone",
        inline: false,
      },
      {
        name: "Match mode",
        value: draft.roleMatchMode === RoleMatchMode.ALL ? "Must hold **all** roles" : "**Any** role qualifies",
        inline: true,
      },
    )
    .setFooter({ text: KOS.footer });

  const postSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.RaffleSetPost, nonce))
    .setPlaceholder("Post the raffle in…")
    .addChannelTypes(...TEXT_CHANNELS)
    .setMinValues(1)
    .setMaxValues(1);
  if (draft.postChannelId) postSelect.setDefaultChannels(draft.postChannelId);

  const announceSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.RaffleSetAnnounce, nonce))
    .setPlaceholder("Announce winners in… (optional)")
    .addChannelTypes(...TEXT_CHANNELS)
    .setMinValues(0)
    .setMaxValues(1);
  if (draft.announceChannelId) announceSelect.setDefaultChannels(draft.announceChannelId);

  const proofSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.RaffleSetProof, nonce))
    .setPlaceholder("Proof channel… (optional)")
    .addChannelTypes(...TEXT_CHANNELS)
    .setMinValues(0)
    .setMaxValues(1);
  if (draft.proofChannelId) proofSelect.setDefaultChannels(draft.proofChannelId);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildId(Actions.RaffleSetRoles, nonce))
    .setPlaceholder("Eligible roles (none = everyone)")
    .setMinValues(0)
    .setMaxValues(5);
  if (draft.roles.length) roleSelect.setDefaultRoles(draft.roles.map((r) => r.roleId));

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(Actions.RaffleToggleMatch, nonce))
      .setLabel(draft.roleMatchMode === RoleMatchMode.ALL ? "Match: ALL" : "Match: ANY")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.RafflePublish, nonce))
      .setLabel("Publish Raffle")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!draft.postChannelId),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.RaffleCancel, nonce))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(postSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(announceSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(proofSelect),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
      buttons,
    ],
  };
}

function expired(
  interaction: ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ButtonInteraction,
) {
  return interaction.update({
    content: "This setup expired. Run `/raffle create` again.",
    embeds: [],
    components: [],
  });
}
