import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { WalletChain } from "@kos/db";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import { buildId, Actions } from "../utils/ids.js";
import { chainLabel, ALL_CHAINS } from "../utils/wallets.js";
import { isRaffleManager } from "../utils/permissions.js";
import {
  upsertWalletProfile,
  getWalletProfiles,
  removeWalletProfile,
  exportAllWalletProfiles,
  buildWalletProfileModal,
} from "../services/walletService.js";
import { fetchTextChannel } from "../services/raffleService.js";
import { toCsv } from "../proof/csv.js";

const CHAIN_CHOICES = ALL_CHAINS.map((c) => ({ name: chainLabel(c), value: c }));

export const walletCommand: Command = {
  // Members use set/view/remove; panel/export do their own manager check.
  managerOnly: false,
  data: new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("Register and manage your wallet addresses")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("register")
        .setDescription("Open a form to add/update all your wallets"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Save or update a wallet address")
        .addStringOption((o) =>
          o.setName("chain").setDescription("Which chain").setRequired(true).addChoices(...CHAIN_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("address").setDescription("Your wallet address").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("View your saved wallet addresses"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a saved wallet address")
        .addStringOption((o) =>
          o.setName("chain").setDescription("Which chain").setRequired(true).addChoices(...CHAIN_CHOICES),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("panel")
        .setDescription("[Manager] Post a wallet-registration panel in this channel"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("export")
        .setDescription("[Manager] Export all registered wallets as CSV"),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case "register":
        return handleRegister(interaction);
      case "set":
        return handleSet(interaction);
      case "view":
        return handleView(interaction);
      case "remove":
        return handleRemove(interaction);
      case "panel":
        return handlePanel(interaction);
      case "export":
        return handleExport(interaction);
      default:
        return interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
    }
  },
};

async function handleRegister(interaction: ChatInputCommandInteraction) {
  const modal = await buildWalletProfileModal(interaction.user.id);
  await interaction.showModal(modal);
}

async function handleSet(interaction: ChatInputCommandInteraction) {
  const chain = interaction.options.getString("chain", true) as WalletChain;
  const address = interaction.options.getString("address", true);
  const res = await upsertWalletProfile({
    userId: interaction.user.id,
    username: interaction.user.username,
    chain,
    address,
  });
  return interaction.reply({
    content: res.ok
      ? `${KOS.emoji.check} Saved your **${chainLabel(chain)}** address.`
      : `${KOS.emoji.cross} ${res.error}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleView(interaction: ChatInputCommandInteraction) {
  const profiles = await getWalletProfiles(interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Your Wallets`)
    .setDescription(
      profiles.length === 0
        ? "You haven't saved any wallets yet. Use `/wallet set` or the registration panel."
        : profiles.map((p) => `**${chainLabel(p.chain)}** — \`${p.address}\``).join("\n"),
    )
    .setFooter({ text: KOS.footer });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  const chain = interaction.options.getString("chain", true) as WalletChain;
  const removed = await removeWalletProfile(interaction.user.id, chain);
  return interaction.reply({
    content: removed
      ? `${KOS.emoji.check} Removed your ${chainLabel(chain)} address.`
      : `You don't have a ${chainLabel(chain)} address saved.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePanel(interaction: ChatInputCommandInteraction) {
  if (!(await isRaffleManager(interaction))) {
    return interaction.reply({ content: "Only managers can post the wallet panel.", flags: MessageFlags.Ephemeral });
  }
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.white)
    .setTitle(`${KOS.emoji.diamond} Wallet Registration`)
    .setDescription(
      [
        "Register your wallet addresses once and they're saved for every raffle.",
        "",
        `Supported chains: **${ALL_CHAINS.map(chainLabel).join(", ")}**`,
        "",
        "Click below to add or update your wallets. You can change them any time.",
      ].join("\n"),
    )
    .setFooter({ text: KOS.footer });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(Actions.OpenWalletProfile))
      .setLabel("Register / Update Wallet")
      .setStyle(ButtonStyle.Secondary),
  );

  const channel = await fetchTextChannel(interaction.client, interaction.channelId);
  if (!channel) {
    return interaction.reply({ content: "Can't post here — use a text channel.", flags: MessageFlags.Ephemeral });
  }
  await channel.send({ embeds: [embed], components: [row] });
  return interaction.reply({ content: `${KOS.emoji.check} Panel posted.`, flags: MessageFlags.Ephemeral });
}

async function handleExport(interaction: ChatInputCommandInteraction) {
  if (!(await isRaffleManager(interaction))) {
    return interaction.reply({ content: "Only managers can export wallets.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await exportAllWalletProfiles();
  const csv = toCsv(
    ["discord_id", "username", "chain", "wallet_address", "updated_at"],
    rows.map((r) => [r.userId, r.username, r.chain, r.address, r.updatedAt.toISOString()]),
  );
  return interaction.editReply({
    content: `${KOS.emoji.check} ${rows.length} registered wallet(s).`,
    files: [new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: "wallet-registry.csv" })],
  });
}
