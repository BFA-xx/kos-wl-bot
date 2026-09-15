import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import { parseId, Actions } from "../utils/ids.js";
import {
  currentEvmAddress,
  getWalletProfiles,
  recordWallet,
  upsertEvmWalletProfiles,
  upsertWalletProfile,
} from "../services/walletService.js";
import {
  handleRaffleCreateModal,
  handleRaffleOptionsModal,
} from "./raffleWizard.js";
import {
  chainLabel,
  ALL_CHAINS,
  EVM_CHAINS,
  EVM_FIELD_ID,
  validateWallet,
} from "../utils/wallets.js";
import { WalletChain } from "@kos/db";
import { KOS } from "../theme.js";
import {
  handleVerificationModal,
  isVerificationModalAction,
} from "./verificationModalHandler.js";
import { handleTeamWalletCountModal } from "./teamWalletFill.js";

export async function handleModal(
  interaction: ModalSubmitInteraction,
): Promise<unknown> {
  const parsed = parseId(interaction.customId);
  if (!parsed) return;
  if (isVerificationModalAction(parsed.action)) {
    return handleVerificationModal(interaction, parsed.action, parsed.args);
  }

  if (parsed.action === Actions.TeamWalletSetSubmit) {
    return handleTeamWalletCountModal(interaction, parsed.args);
  }
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

  // One 0x field covers every EVM network. Unchanged from its pre-filled value
  // means "fill the networks I don't have yet" — a per-network override set via
  // /wallet set is kept; a new value replaces the address everywhere.
  const evmValue = interaction.fields.fields.has(EVM_FIELD_ID)
    ? interaction.fields.getTextInputValue(EVM_FIELD_ID).trim()
    : "";
  if (evmValue) {
    const check = validateWallet(WalletChain.ETHEREUM, evmValue);
    const current = currentEvmAddress(
      await getWalletProfiles(interaction.user.id).catch(() => []),
    );
    const unchanged =
      check.valid && current !== undefined && check.normalized === current;
    const res = await upsertEvmWalletProfiles({
      userId: interaction.user.id,
      username: interaction.user.username,
      address: evmValue,
      onlyMissing: unchanged,
    });
    if (!res.ok) {
      results.push(`${KOS.emoji.cross} EVM address: ${res.error}`);
    } else if (unchanged) {
      results.push(
        res.chains?.length
          ? `${KOS.emoji.check} EVM address unchanged — added to ${res.chains.length} more network${res.chains.length === 1 ? "" : "s"}.`
          : `${KOS.emoji.check} EVM address unchanged.`,
      );
      savedAny = true;
    } else {
      results.push(
        `${KOS.emoji.check} EVM address saved for all ${EVM_CHAINS.length} networks.`,
      );
      savedAny = true;
    }
  }

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
    [
      savedAny ? "**Wallets updated.**" : "**Submission had errors:**",
      ...results,
    ].join("\n"),
  );
}

async function handleWalletSubmit(
  interaction: ModalSubmitInteraction,
  raffleId: number,
) {
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
    [
      anySaved
        ? "**Wallet submission received.**"
        : "**Submission had errors:**",
      ...results,
    ].join("\n"),
  );
}
