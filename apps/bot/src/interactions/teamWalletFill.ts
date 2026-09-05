import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { KOS } from "../theme.js";
import { buildId, Actions } from "../utils/ids.js";
import { isKOSManager } from "../utils/permissions.js";
import {
  confirmFill,
  previewFill,
  type FillPreview,
  type SelectionMode,
} from "../services/teamWalletFillService.js";

/**
 * The Team Wallet Pool fill, as an ephemeral Discord panel.
 *
 * Mirrors the dashboard modal: adjust the count, pick a selection mode,
 * preview what would be reserved, then confirm. Discord custom ids cap at 100
 * characters and cannot carry a wallet list, so the panel round-trips only
 * `raffleId / count / mode` and the dashboard re-selects inside the reserving
 * transaction — which also means nothing stale can be reserved.
 */

/** Short codes keep the custom id well inside Discord's 100-char limit. */
const MODE_CODES: Record<string, SelectionMode> = {
  R: "ROUND_ROBIN",
  N: "RANDOM",
  P: "PRIORITY",
};
const CODE_BY_MODE: Record<SelectionMode, string> = {
  ROUND_ROBIN: "R",
  RANDOM: "N",
  PRIORITY: "P",
};

const MODE_LABELS: Record<SelectionMode, string> = {
  ROUND_ROBIN: "Round Robin (spreads across members)",
  RANDOM: "Random",
  PRIORITY: "Priority (pool order)",
};

export interface PanelState {
  raffleId: number;
  count: number;
  mode: SelectionMode;
}

export function encodeState(state: PanelState): [string, string, string] {
  return [
    String(state.raffleId),
    String(state.count),
    CODE_BY_MODE[state.mode],
  ];
}

export function decodeState(args: string[]): PanelState | null {
  const raffleId = Number(args[0]);
  const count = Number(args[1]);
  const mode = MODE_CODES[args[2] ?? ""];
  if (!Number.isSafeInteger(raffleId) || raffleId < 1) return null;
  if (!Number.isSafeInteger(count) || count < 0) return null;
  if (!mode) return null;
  return { raffleId, count, mode };
}

/** Clamp a proposed count to what the pool can actually supply. */
export function clampCount(next: number, maxSelectable: number): number {
  if (maxSelectable < 1) return 0;
  return Math.min(maxSelectable, Math.max(1, next));
}

export function buildFillEmbed(
  preview: FillPreview,
  count: number,
): EmbedBuilder {
  const total = preview.communityWallets + preview.teamWalletsReserved + count;
  const over = total - preview.requiredWallets;
  const standing =
    over > 0
      ? `${over} over the raffle's ${preview.requiredWallets} spots — expected when spots were held back for the team.`
      : over === 0
        ? "Exactly the raffle's spot count."
        : `${-over} of the raffle's ${preview.requiredWallets} spots still open.`;

  const list = preview.selectedWallets.length
    ? preview.selectedWallets
        .slice(0, 15)
        .map(
          (wallet, index) =>
            `\`${String(index + 1).padStart(2)}.\` \`${shortAddress(wallet.address)}\` — ${wallet.ownerName}`,
        )
        .join("\n") +
      (preview.selectedWallets.length > 15
        ? `\n…and ${preview.selectedWallets.length - 15} more`
        : "")
    : "_No wallets selected._";

  return new EmbedBuilder()
    .setColor(KOS.colors.white)
    .setTitle(
      `${KOS.emoji.diamond} Fill Team Wallets — ${preview.raffle.projectName} ${preview.raffle.title}`.slice(
        0,
        256,
      ),
    )
    .setDescription(
      [
        `**Required:** ${preview.requiredWallets}  ·  **Community:** ${preview.communityWallets}  ·  **Team:** ${preview.teamWalletsReserved + count}  ·  **Total:** ${total}`,
        standing,
        "",
        `**Adding:** ${count} of ${preview.availableWallets} available  ·  **Mode:** ${MODE_LABELS[preview.selectionMode]}`,
      ].join("\n"),
    )
    .addFields({ name: "Selection preview", value: list.slice(0, 1024) })
    .setFooter({ text: `${KOS.footer} · Raffle #${preview.raffle.id}` });
}

export function buildFillComponents(preview: FillPreview, count: number) {
  const state = encodeState({
    raffleId: preview.raffle.id,
    count,
    mode: preview.selectionMode,
  });
  const atFloor = count <= 1;
  const atCeiling = count >= preview.maxSelectable;

  const modeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(buildId(Actions.TeamWalletMode, state[0], state[1]))
      .setPlaceholder(`Selection mode — ${MODE_LABELS[preview.selectionMode]}`)
      .addOptions(
        (Object.keys(MODE_LABELS) as SelectionMode[]).map((mode) => ({
          label: MODE_LABELS[mode].slice(0, 100),
          value: CODE_BY_MODE[mode],
          default: mode === preview.selectionMode,
        })),
      ),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(Actions.TeamWalletDec, ...state))
      .setLabel("−1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atFloor),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.TeamWalletInc, ...state))
      .setLabel("+1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atCeiling),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.TeamWalletMax, ...state))
      .setLabel("Max")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atCeiling),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.TeamWalletConfirm, ...state))
      .setLabel(`Reserve ${count}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(count < 1),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.TeamWalletCancel, ...state))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  return [modeRow, buttonRow];
}

function shortAddress(address: string): string {
  return address.length > 18
    ? `${address.slice(0, 8)}…${address.slice(-6)}`
    : address;
}

/** `/raffle fill` — open the panel. */
export async function openTeamWalletFill(
  interaction: ChatInputCommandInteraction,
): Promise<unknown> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const raffleId = interaction.options.getInteger("id", true);
  const outcome = await previewFill({
    raffleId,
    guildId: interaction.guildId!,
    actorId: interaction.user.id,
  });
  if (!outcome.ok) return interaction.editReply(failure(outcome.reason));

  const preview = outcome.data;
  if (preview.maxSelectable < 1) {
    return interaction.editReply(
      `${KOS.emoji.warn} No eligible team wallets are available for raffle #${raffleId}'s chains right now.`,
    );
  }
  return interaction.editReply({
    embeds: [buildFillEmbed(preview, preview.selectedCount)],
    components: buildFillComponents(preview, preview.selectedCount),
  });
}

/** Every button and dropdown on the panel. */
export async function handleTeamWalletFillComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  action: string,
  args: string[],
): Promise<unknown> {
  // Component interactions arrive independently of the command that posted
  // the panel, so manager rights are re-checked on every press rather than
  // trusted from the original invocation.
  if (!(await isKOSManager(interaction))) {
    return interaction.reply({
      content: "Only raffle managers can fill team wallets.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === Actions.TeamWalletCancel) {
    return interaction.update({
      content: "Fill cancelled — nothing was reserved.",
      embeds: [],
      components: [],
    });
  }

  const state =
    action === Actions.TeamWalletMode
      ? decodeState([
          args[0] ?? "",
          args[1] ?? "",
          (interaction as StringSelectMenuInteraction).values[0] ?? "",
        ])
      : decodeState(args);
  if (!state) {
    return interaction.update({
      content: "That panel is no longer valid. Run `/raffle fill` again.",
      embeds: [],
      components: [],
    });
  }

  await interaction.deferUpdate();

  if (action === Actions.TeamWalletConfirm) {
    const result = await confirmFill({
      raffleId: state.raffleId,
      guildId: interaction.guildId!,
      actorId: interaction.user.id,
      count: state.count,
      selectionMode: state.mode,
    });
    if (!result.ok) {
      return interaction.editReply({
        content: `${KOS.emoji.warn} ${result.reason}`,
        embeds: [],
        components: [],
      });
    }
    const { data } = result;
    return interaction.editReply({
      content: [
        `${KOS.emoji.check} Reserved **${data.selected}** team wallet${data.selected === 1 ? "" : "s"} for raffle #${state.raffleId}.`,
        data.remaining > 0
          ? `${data.remaining} of the raffle's spots still open.`
          : "The raffle's spots are fully covered.",
        "",
        ...data.wallets
          .slice(0, 15)
          .map((w) => `\`${shortAddress(w.address)}\` — ${w.ownerName}`),
        data.wallets.length > 15 ? `…and ${data.wallets.length - 15} more` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000),
      embeds: [],
      components: [],
    });
  }

  // Re-preview so the wallet list shown always matches the current count and
  // mode, and so availability that moved underneath us is reflected.
  const probe = await previewFill({
    raffleId: state.raffleId,
    guildId: interaction.guildId!,
    actorId: interaction.user.id,
  });
  if (!probe.ok) {
    return interaction.editReply({
      content: `${KOS.emoji.warn} ${probe.reason}`,
      embeds: [],
      components: [],
    });
  }
  const ceiling = probe.data.maxSelectable;
  const nextCount =
    action === Actions.TeamWalletInc
      ? clampCount(state.count + 1, ceiling)
      : action === Actions.TeamWalletDec
        ? clampCount(state.count - 1, ceiling)
        : action === Actions.TeamWalletMax
          ? clampCount(ceiling, ceiling)
          : clampCount(state.count, ceiling);

  const outcome = await previewFill({
    raffleId: state.raffleId,
    guildId: interaction.guildId!,
    actorId: interaction.user.id,
    count: nextCount,
    selectionMode: state.mode,
  });
  if (!outcome.ok) {
    return interaction.editReply({
      content: `${KOS.emoji.warn} ${outcome.reason}`,
      embeds: [],
      components: [],
    });
  }
  return interaction.editReply({
    embeds: [buildFillEmbed(outcome.data, nextCount)],
    components: buildFillComponents(outcome.data, nextCount),
  });
}

function failure(reason: string): string {
  return `${KOS.emoji.warn} ${reason}`;
}

export function isTeamWalletFillAction(action: string): boolean {
  return (
    action === Actions.TeamWalletInc ||
    action === Actions.TeamWalletDec ||
    action === Actions.TeamWalletMax ||
    action === Actions.TeamWalletMode ||
    action === Actions.TeamWalletConfirm ||
    action === Actions.TeamWalletCancel
  );
}
