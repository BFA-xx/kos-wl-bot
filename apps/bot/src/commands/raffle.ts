import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { prisma, RaffleStatus, Prisma } from "@kos/db";
import type { Command } from "../types.js";
import { resolveTime } from "../utils/time.js";
import { KOS, statusBadge } from "../theme.js";
import {
  refreshRaffleMessage,
  publishRaffleMessage,
  deleteRaffle,
  editRaffle,
  listRaffles,
  getRaffle,
  getGuildStats,
} from "../services/raffleService.js";
import { closeAndDraw, rerollWinners } from "../services/winnerService.js";
import { getWinnerWallets } from "../services/walletService.js";
import { stashBanner } from "../services/pendingRaffles.js";
import { buildId, Actions } from "../utils/ids.js";
import { participantsCsv, winnersCsv } from "../proof/csv.js";

export const raffleCommand: Command = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("raffle")
    .setDescription("Manage KOS whitelist raffles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    // ---- create (opens a popup form, then a setup panel) ----
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a whitelist raffle (opens a setup form)")
        .addAttachmentOption((o) =>
          o.setName("banner").setDescription("Optional banner image (drag & drop)"),
        ),
    )
    // ---- repost ----
    .addSubcommand((sub) =>
      sub
        .setName("repost")
        .setDescription("Re-post a raffle's embed (e.g. after fixing permissions)")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true),
        ),
    )
    // ---- edit ----
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing raffle")
        .addIntegerOption((o) => o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("title").setDescription("New title"))
        .addIntegerOption((o) => o.setName("spots").setDescription("New WL spot count").setMinValue(1))
        .addStringOption((o) => o.setName("end").setDescription("New end time (24h, 2d, ISO)"))
        .addStringOption((o) => o.setName("link").setDescription("New external link")),
    )
    // ---- delete ----
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a raffle and its message")
        .addIntegerOption((o) => o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true)),
    )
    // ---- end ----
    .addSubcommand((sub) =>
      sub
        .setName("end")
        .setDescription("End a raffle now and draw winners")
        .addIntegerOption((o) => o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true)),
    )
    // ---- reroll ----
    .addSubcommand((sub) =>
      sub
        .setName("reroll")
        .setDescription("Reroll winners of an ended raffle")
        .addIntegerOption((o) => o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("What to reroll")
            .setRequired(true)
            .addChoices(
              { name: "Single winner", value: "single" },
              { name: "Multiple winners", value: "multiple" },
              { name: "Entire winner pool", value: "all" },
            ),
        )
        .addUserOption((o) => o.setName("user").setDescription("Winner to replace (single mode)"))
        .addIntegerOption((o) => o.setName("count").setDescription("How many to replace (multiple mode)").setMinValue(1)),
    )
    // ---- list ----
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List raffles in this server")
        .addStringOption((o) =>
          o
            .setName("status")
            .setDescription("Filter by status")
            .addChoices(
              { name: "Live", value: "LIVE" },
              { name: "Upcoming", value: "UPCOMING" },
              { name: "Ended", value: "ENDED" },
            ),
        ),
    )
    // ---- stats ----
    .addSubcommand((sub) =>
      sub.setName("stats").setDescription("Show raffle statistics for this server"),
    )
    // ---- export ----
    .addSubcommand((sub) =>
      sub
        .setName("export")
        .setDescription("Export raffle data as CSV")
        .addIntegerOption((o) => o.setName("id").setDescription("Raffle ID").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("What to export")
            .addChoices(
              { name: "Winners (+ wallets)", value: "winners" },
              { name: "Participants", value: "participants" },
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case "create":
        return handleCreate(interaction);
      case "repost":
        return handleRepost(interaction);
      case "edit":
        return handleEdit(interaction);
      case "delete":
        return handleDelete(interaction);
      case "end":
        return handleEnd(interaction);
      case "reroll":
        return handleReroll(interaction);
      case "list":
        return handleList(interaction);
      case "stats":
        return handleStats(interaction);
      case "export":
        return handleExport(interaction);
      default:
        await interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.inGuild()) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "id") return interaction.respond([]);

    const raffles = await prisma.raffle.findMany({
      where: { guildId: interaction.guildId! },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, title: true, status: true },
    });
    const q = String(focused.value).toLowerCase();
    await interaction.respond(
      raffles
        .filter((r) => !q || String(r.id).includes(q) || r.title.toLowerCase().includes(q))
        .slice(0, 25)
        .map((r) => ({ name: `#${r.id} · ${r.title} [${r.status}]`.slice(0, 100), value: r.id })),
    );
  },
};

async function handleCreate(interaction: ChatInputCommandInteraction) {
  // If a banner image was attached to the command, stash its URL so the modal
  // submit can attach it to the draft (modals can't hold file uploads).
  const banner = interaction.options.getAttachment("banner");
  if (banner?.url) stashBanner(interaction.user.id, banner.url);

  // Step 1: open the popup form. Channels/roles are chosen on the panel that
  // follows the modal (see raffleWizard).
  const modal = new ModalBuilder()
    .setCustomId(buildId(Actions.SubmitRaffleCreate))
    .setTitle("Create Raffle")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("project")
          .setLabel("Project name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Raffle title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(120),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("spots")
          .setLabel("WL spots")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. 5"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("start")
          .setLabel("Start (date & time)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("now, or 2026-06-25 17:00, or 'tomorrow 5pm'"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("end")
          .setLabel("End (date & time, or duration)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. 24h, 2d, or 2026-06-26 17:00"),
      ),
    );

  await interaction.showModal(modal);
}

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

async function handleRepost(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }
  const result = await publishRaffleMessage(interaction.client, id);
  return interaction.editReply(
    result.ok
      ? `${KOS.emoji.check} Re-posted raffle #${id} in <#${raffle.channelId}>.`
      : `${KOS.emoji.cross} Couldn't post: ${result.reason}`,
  );
}

async function handleEdit(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }

  const data: Prisma.RaffleUpdateInput = {};
  const title = interaction.options.getString("title");
  const spots = interaction.options.getInteger("spots");
  const end = interaction.options.getString("end");
  const link = interaction.options.getString("link");
  if (title) data.title = title;
  if (spots) data.spots = spots;
  if (link !== null) data.externalUrl = link;
  if (end) {
    const endAt = resolveTime(end, new Date());
    if (!endAt) return interaction.editReply("Could not parse the new end time.");
    data.endAt = endAt;
    if (raffle.status === RaffleStatus.ENDED) data.status = RaffleStatus.LIVE; // reopen
  }
  if (Object.keys(data).length === 0) {
    return interaction.editReply("Nothing to update — provide at least one field.");
  }

  await editRaffle(id, interaction.user.id, data);
  await refreshRaffleMessage(interaction.client, id);
  await interaction.editReply(`${KOS.emoji.check} Updated raffle #${id}.`);
}

async function handleDelete(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }
  await deleteRaffle(id, interaction.user.id, interaction.client);
  await interaction.editReply(`${KOS.emoji.check} Deleted raffle #${id}.`);
}

async function handleEnd(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }
  if (raffle.status === RaffleStatus.ENDED) {
    return interaction.editReply("That raffle has already ended.");
  }
  await closeAndDraw(interaction.client, id, interaction.user.id);
  await interaction.editReply(`${KOS.emoji.check} Ended raffle #${id} and drew winners. Proof delivered.`);
}

async function handleReroll(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const mode = interaction.options.getString("mode", true) as "single" | "multiple" | "all";
  const user = interaction.options.getUser("user");
  const count = interaction.options.getInteger("count") ?? undefined;

  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }

  const result = await rerollWinners(interaction.client, id, interaction.user.id, {
    mode,
    userIds: user ? [user.id] : undefined,
    count,
  });
  if (!result) {
    return interaction.editReply("Reroll failed — the raffle must be ENDED with eligible replacements available.");
  }
  await interaction.editReply(
    `${KOS.emoji.check} Rerolled ${result.replaced.length} winner(s). New: ${
      result.added.map((w) => `<@${w.userId}>`).join(", ") || "none (pool exhausted)"
    }`,
  );
}

async function handleList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = interaction.options.getString("status") as RaffleStatus | null;
  const raffles = await listRaffles(interaction.guildId!, status ?? undefined);
  if (raffles.length === 0) {
    return interaction.editReply("No raffles found.");
  }
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Raffles`)
    .setDescription(
      raffles
        .map(
          (r) =>
            `**#${r.id}** · ${statusBadge(r.status)} · ${r.title} — ${r.entryCount} entries / ${r.spots} spots`,
        )
        .join("\n")
        .slice(0, 4000),
    )
    .setFooter({ text: KOS.footer });
  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const stats = await getGuildStats(interaction.guildId!);
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setTitle(`${KOS.emoji.diamond} Raffle Statistics`)
    .addFields(
      { name: "Total Raffles", value: String(stats.totalRaffles), inline: true },
      { name: "Live Now", value: String(stats.liveRaffles), inline: true },
      { name: "Total Winners", value: String(stats.totalWinners), inline: true },
      { name: "Total Entries", value: String(stats.totalEntries), inline: true },
      { name: "Unique Participants", value: String(stats.uniqueParticipants), inline: true },
    )
    .setFooter({ text: KOS.footer });
  await interaction.editReply({ embeds: [embed] });
}

async function handleExport(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = interaction.options.getInteger("id", true);
  const type = interaction.options.getString("type") ?? "winners";
  const raffle = await getRaffle(id);
  if (!raffle || raffle.guildId !== interaction.guildId) {
    return interaction.editReply("Raffle not found.");
  }

  let csv: string;
  let filename: string;
  if (type === "participants") {
    const rows = await prisma.participant.findMany({
      where: { raffleId: id },
      orderBy: { enteredAt: "asc" },
    });
    csv = participantsCsv(rows);
    filename = `participants-${id}.csv`;
  } else {
    const rows = await getWinnerWallets(id);
    csv = winnersCsv(rows);
    filename = `winners-${id}.csv`;
  }

  await interaction.editReply({
    content: `${KOS.emoji.check} Export ready for raffle #${id}.`,
    files: [new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: filename })],
  });
}
