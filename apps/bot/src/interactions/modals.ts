import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { parseId, Actions } from "../utils/ids.js";
import { recordWallet, upsertWalletProfile } from "../services/walletService.js";
import { handleRaffleCreateModal, handleRaffleOptionsModal } from "./raffleWizard.js";
import { chainLabel, ALL_CHAINS } from "../utils/wallets.js";
import { KOS } from "../theme.js";

export async function handleModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;

  if (parsed.action === Actions.SubmitRaffleCreate) {
    return handleRaffleCreateModal(interaction);
  }
  if (parsed.action === Actions.SubmitRaffleOptions) {
    return handleRaffleOptionsModal(interaction);
  }
  if (parsed.action === Actions.SubmitWallet) {
    return handleWalletSubmit(interaction, Number(parsed.args[0]));
  }
  if (parsed.action === Actions.SubmitWalletProfile) {
    return handleWalletProfileSubmit(interaction);
  }
}

async function handleWalletProfileSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const results: string[] = [];
  let savedAny = false;

  for (const chain of ALL_CHAINS) {
    if (!interaction.fields.fields.has(chain)) continue;
    const value = interaction.fields.getTextInputValue(chain).trim();
    if (!value) continue;

    const res = await upsertWalletProfile({
      userId: interaction.user.id,
      username: interaction.user.username,
      chain,
      address: value,
    });
    results.push(
      res.ok
        ? `${KOS.emoji.check} ${chainLabel(chain)} saved.`
        : `${KOS.emoji.cross} ${chainLabel(chain)}: ${res.error}`,
    );
    if (res.ok) savedAny = true;
  }

  if (results.length === 0) {
    return interaction.editReply("No addresses entered — nothing changed.");
  }
  return interaction.editReply(
    [savedAny ? "**Wallets updated.**" : "**Submission had errors:**", ...results].join("\n"),
  );
}

async function handleWalletSubmit(interaction: ModalSubmitInteraction, raffleId: number) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const results: string[] = [];
  let anySaved = false;

  for (const chain of ALL_CHAINS) {
    if (!interaction.fields.fields.has(chain)) continue;
    const value = interaction.fields.getTextInputValue(chain).trim();
    if (!value) continue;

    const res = await recordWallet({
      raffleId,
      userId: interaction.user.id,
      username: interaction.user.username,
      chain,
      address: value,
    });
    results.push(
      res.ok
        ? `${KOS.emoji.check} ${chainLabel(chain)} saved.`
        : `${KOS.emoji.cross} ${chainLabel(chain)}: ${res.error}`,
    );
    if (res.ok) anySaved = true;
  }

  if (results.length === 0) {
    return interaction.editReply("You didn't enter any wallet address.");
  }
  return interaction.editReply(
    [anySaved ? "**Wallet submission received.**" : "**Submission had errors:**", ...results].join("\n"),
  );
}
