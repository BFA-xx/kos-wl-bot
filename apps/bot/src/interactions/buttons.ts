import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ButtonInteraction,
} from "discord.js";
import { prisma, WalletChain } from "@kos/db";
import { config } from "../config.js";
import { parseId, Actions, buildId } from "../utils/ids.js";
import { RateLimiter } from "../utils/rateLimit.js";
import { enterRaffle, leaveRaffle } from "../services/entryService.js";
import { buildWalletProfileModal } from "../services/walletService.js";
import { handleRaffleWizardButton } from "./raffleWizard.js";
import { chainLabel } from "../utils/wallets.js";
import { KOS } from "../theme.js";
import { logger } from "../logger.js";

/** Shared per-user enter/leave rate limiter (anti-spam). */
export const entryLimiter = new RateLimiter(
  config.ENTRY_RATE_LIMIT_PER_MINUTE,
  60_000,
);

export async function handleButton(interaction: ButtonInteraction): Promise<unknown> {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;

  switch (parsed.action) {
    case Actions.EnterRaffle:
      return handleEnter(interaction, Number(parsed.args[0]));
    case Actions.LeaveRaffle:
      return handleLeave(interaction, Number(parsed.args[0]));
    case Actions.OpenWalletForm:
      return handleOpenWalletForm(interaction, Number(parsed.args[0]));
    case Actions.OpenWalletProfile:
      return handleOpenWalletProfile(interaction);
    case Actions.RaffleToggleMatch:
    case Actions.RaffleToggleHide:
    case Actions.RaffleCyclePing:
    case Actions.RaffleMoreOptions:
    case Actions.RafflePublish:
    case Actions.RaffleCancel:
      return handleRaffleWizardButton(interaction);
    default:
      return;
  }
}

async function handleOpenWalletProfile(interaction: ButtonInteraction) {
  const modal = await buildWalletProfileModal(interaction.user.id);
  await interaction.showModal(modal).catch((err) => logger.warn({ err }, "showModal (profile) failed"));
}

async function handleEnter(interaction: ButtonInteraction, raffleId: number) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "Raffles can only be entered in a server.", flags: MessageFlags.Ephemeral });
  }
  if (!entryLimiter.take(`${interaction.user.id}`)) {
    return interaction.reply({ content: "You're clicking too fast — try again in a moment.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply("Could not verify your server membership.");

  const result = await enterRaffle(raffleId, member);
  switch (result.status) {
    case "entered": {
      let msg = `${KOS.emoji.check} Successfully entered the raffle.`;
      if (result.missingWalletChains.length > 0) {
        const chains = result.missingWalletChains.map(chainLabel).join(", ");
        msg +=
          `\n\n⚠️ You haven't added a **${chains}** wallet yet. If you win, we'll need it — ` +
          `run **/wallet register** to add it now (you can still win without it, but add it to be safe).`;
      }
      return interaction.editReply(msg);
    }
    case "duplicate":
      return interaction.editReply("You are already participating.");
    case "ineligible":
      return interaction.editReply(
        `${KOS.emoji.cross} You do not meet the requirements for this raffle.\n${result.reasons
          .map((r) => `• ${r}`)
          .join("\n")}`,
      );
    case "no_wallet": {
      const chains = result.chains.map(chainLabel).join(" / ");
      return interaction.editReply(
        `${KOS.emoji.cross} This raffle requires a wallet to enter. Add your **${chains}** ` +
          `wallet with **/wallet register**, then click **Enter Giveaway** again.`,
      );
    }
    case "closed":
      return interaction.editReply("This raffle is not currently open for entries.");
    default:
      return interaction.editReply("Something went wrong. Please try again.");
  }
}

async function handleLeave(interaction: ButtonInteraction, raffleId: number) {
  if (!interaction.inCachedGuild()) return;
  if (!entryLimiter.take(`${interaction.user.id}`)) {
    return interaction.reply({ content: "You're clicking too fast — try again in a moment.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.editReply("Could not verify your server membership.");

  const result = await leaveRaffle(raffleId, member);
  switch (result.status) {
    case "left":
      return interaction.editReply("You have left the raffle.");
    case "not_entered":
      return interaction.editReply("You are not entered in this raffle.");
    case "closed":
      return interaction.editReply("This raffle is closed — entries are locked.");
    default:
      return interaction.editReply("Something went wrong. Please try again.");
  }
}

async function handleOpenWalletForm(interaction: ButtonInteraction, raffleId: number) {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { walletChains: true, projectName: true },
  });
  if (!raffle) {
    return interaction.reply({ content: "This raffle no longer exists.", flags: MessageFlags.Ephemeral });
  }

  // Confirm the clicker is actually a current winner.
  const winner = await prisma.winner.findFirst({
    where: { raffleId, userId: interaction.user.id, replaced: false },
    select: { id: true },
  });
  if (!winner) {
    return interaction.reply({ content: "You are not a current winner of this raffle.", flags: MessageFlags.Ephemeral });
  }

  const chains = raffle.walletChains.length ? raffle.walletChains : [WalletChain.ETHEREUM];
  const modal = new ModalBuilder()
    .setCustomId(buildId(Actions.SubmitWallet, raffleId))
    .setTitle(`Wallet — ${raffle.projectName}`.slice(0, 45));

  for (const chain of chains.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(chain)
      .setLabel(`${chainLabel(chain)} address`)
      .setStyle(TextInputStyle.Short)
      .setRequired(chains.length === 1)
      .setMaxLength(120);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  await interaction.showModal(modal).catch((err) => logger.warn({ err }, "showModal failed"));
}
