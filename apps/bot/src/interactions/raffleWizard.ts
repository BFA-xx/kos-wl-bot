import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
  type ModalSubmitInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
} from "discord.js";
import { prisma, RoleMatchMode, WalletChain } from "@kos/db";
import { ALL_CHAINS, chainLabel } from "../utils/wallets.js";
import { buildId, parseId, Actions } from "../utils/ids.js";
import { stashPending, getPending, takePending, takeBanner, type PendingRaffle } from "../services/pendingRaffles.js";
import {
  createRaffle,
  publishRaffleMessage,
  fetchTextChannel,
  missingPostPermissions,
} from "../services/raffleService.js";
import { resolveWhen, resolveTime, discordRelative } from "../utils/time.js";
import type { EntryRequirements } from "../types.js";
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
    description: null,
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
    hideEntries: false,
    requirements: null,
    bannerUrl: takeBanner(interaction.user.id),
    externalUrl: null,
  });

  const draft = getPending(nonce)!;
  return interaction.reply({ ...buildPanel(nonce, draft), flags: MessageFlags.Ephemeral });
}

/** A panel select (channel / role / chain) changed. */
export async function handleRaffleSelect(
  interaction:
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | StringSelectMenuInteraction,
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
    case Actions.RaffleSetChains: {
      const chains = interaction.values.filter((v): v is WalletChain =>
        (ALL_CHAINS as string[]).includes(v),
      );
      if (chains.length > 0) draft.walletChains = chains;
      break;
    }
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

  if (parsed.action === Actions.RaffleToggleHide) {
    draft.hideEntries = !draft.hideEntries;
    return interaction.update(buildPanel(nonce, draft));
  }

  if (parsed.action === Actions.RaffleMoreOptions) {
    return showOptionsModal(interaction, nonce, draft);
  }

  if (parsed.action === Actions.RafflePublish) {
    return publish(interaction, nonce, draft);
  }
}

/** Open the optional extras modal (banner, link, tasks, anti-alt). */
async function showOptionsModal(interaction: ButtonInteraction, nonce: string, draft: PendingRaffle) {
  const req = (draft.requirements ?? {}) as EntryRequirements;
  const tasksText = (req.tasks ?? []).map((t) => `${t.label} | ${t.url}`).join("\n");

  const modal = new ModalBuilder()
    .setCustomId(buildId(Actions.SubmitRaffleOptions, nonce))
    .setTitle("Description / Banner / Tasks")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Description (shown under the title)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(draft.description ?? "")
          .setPlaceholder("Tell people about the project…"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("banner")
          .setLabel("Banner image URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(draft.bannerUrl ?? "")
          .setPlaceholder("https://… (png/jpg/gif)"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("External link (makes the title clickable)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(draft.externalUrl ?? "")
          .setPlaceholder("https://projectx.xyz"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("tasks")
          .setLabel("Tasks — paste X / Discord links (1 per line)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(tasksText)
          .setPlaceholder("https://x.com/ProjectX/status/123\nhttps://discord.gg/abc"),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("anti_alt")
          .setLabel("Anti-alt: min account, server age (days)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(
            req.minAccountAgeDays || req.minServerAgeDays
              ? `${req.minAccountAgeDays ?? 0},${req.minServerAgeDays ?? 0}`
              : "",
          )
          .setPlaceholder("e.g. 7,3  (account 7d, in server 3d)"),
      ),
    );

  await interaction.showModal(modal);
}

/** Save the extras modal back into the draft. */
export async function handleRaffleOptionsModal(interaction: ModalSubmitInteraction) {
  const parsed = parseId(interaction.customId);
  const nonce = parsed?.args[0] ?? "";
  const draft = getPending(nonce);
  if (!draft) {
    return interaction.reply({ content: "This setup expired. Run `/raffle create` again.", flags: MessageFlags.Ephemeral });
  }

  const description = interaction.fields.getTextInputValue("description").trim();
  const banner = interaction.fields.getTextInputValue("banner").trim();
  const link = interaction.fields.getTextInputValue("link").trim();
  const tasksRaw = interaction.fields.getTextInputValue("tasks");
  const aa = interaction.fields
    .getTextInputValue("anti_alt")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10));
  const minAccount = aa[0] ?? NaN;
  const minServer = aa[1] ?? NaN;

  draft.description = description || null;
  draft.bannerUrl = isHttpUrl(banner) ? banner : null;
  draft.externalUrl = isHttpUrl(link) ? link : null;

  const tasks = parseTasks(tasksRaw);
  const req: EntryRequirements = { ...((draft.requirements ?? {}) as EntryRequirements) };
  if (tasks.length) req.tasks = tasks;
  else delete req.tasks;
  if (Number.isFinite(minAccount) && minAccount > 0) req.minAccountAgeDays = minAccount;
  else delete req.minAccountAgeDays;
  if (Number.isFinite(minServer) && minServer > 0) req.minServerAgeDays = minServer;
  else delete req.minServerAgeDays;
  draft.requirements = Object.keys(req).length ? req : null;

  const summary = [
    `${KOS.emoji.check} Saved extras.`,
    draft.description ? "• Description set" : null,
    draft.bannerUrl ? "• Banner set" : null,
    draft.externalUrl ? "• Link set" : null,
    tasks.length ? `• ${tasks.length} task button(s)` : null,
    req.minAccountAgeDays ? `• Min account age ${req.minAccountAgeDays}d` : null,
    req.minServerAgeDays ? `• Min server age ${req.minServerAgeDays}d` : null,
    "",
    "Return to the setup panel above and click **Publish Raffle**.",
  ]
    .filter(Boolean)
    .join("\n");

  return interaction.reply({ content: summary, flags: MessageFlags.Ephemeral });
}

function extrasSummary(draft: PendingRaffle): string {
  const req = (draft.requirements ?? {}) as EntryRequirements;
  const bits: string[] = [];
  if (draft.description) bits.push("description");
  if (draft.bannerUrl) bits.push("banner");
  if (draft.externalUrl) bits.push("link");
  if (req.tasks?.length) bits.push(`${req.tasks.length} task button(s)`);
  if (req.minAccountAgeDays) bits.push(`acct ${req.minAccountAgeDays}d`);
  if (req.minServerAgeDays) bits.push(`server ${req.minServerAgeDays}d`);
  return bits.length ? bits.join(", ") : "_none — use the button_";
}

function row(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//iu.test(s);
}

/**
 * Turn pasted social links into task buttons. An X/Twitter tweet link expands
 * into Like + Retweet + Follow buttons; a profile link → Follow; a Discord
 * invite → Join; anything else → a plain link button. `Label | URL` is honoured
 * for custom labels. Capped at 5 buttons (one row).
 */
function parseTasks(raw: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const add = (label: string, url: string) => {
    if (out.length < 5 && !out.some((t) => t.url === url)) {
      out.push({ label: label.slice(0, 40), url });
    }
  };

  const tweet = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/iu;
  const profile = /(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/?(?:\?.*)?$/iu;
  const discord = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/iu;

  for (const line of (raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || out.length >= 5) continue;

    let label: string | null = null;
    let url = trimmed;
    if (trimmed.includes("|")) {
      const [l, u] = trimmed.split("|").map((s) => s.trim());
      label = l || null;
      url = u ?? "";
    }
    if (!isHttpUrl(url)) continue;

    const tw = tweet.exec(url);
    if (tw) {
      const user = tw[1];
      const id = tw[2];
      add("Like", `https://twitter.com/intent/like?tweet_id=${id}`);
      add("Retweet", `https://twitter.com/intent/retweet?tweet_id=${id}`);
      add(`Follow @${user}`, `https://twitter.com/intent/follow?screen_name=${user}`);
      continue;
    }
    const pr = profile.exec(url);
    if (pr && !/\/(home|search|explore|i)\b/iu.test(url)) {
      add(label ?? `Follow @${pr[1]}`, `https://twitter.com/intent/follow?screen_name=${pr[1]}`);
      continue;
    }
    if (discord.test(url)) {
      add(label ?? "Join Discord", url);
      continue;
    }
    add(label ?? "Open link", url);
  }
  return out;
}

async function publish(interaction: ButtonInteraction, nonce: string, draft: PendingRaffle) {
  if (!draft.postChannelId) {
    return interaction.reply({ content: "Pick a channel to post the raffle in first.", flags: MessageFlags.Ephemeral });
  }

  // Pre-flight: make sure we can actually post before creating anything, so we
  // never leave an orphaned raffle that failed to post.
  const channel = await fetchTextChannel(interaction.client, draft.postChannelId);
  if (!channel) {
    return interaction.reply({
      content: `I can't see <#${draft.postChannelId}>. Pick a text channel I have access to, then Publish again.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe().catch(() => null));
  const missing = missingPostPermissions(channel, me);
  if (missing.length > 0) {
    return interaction.reply({
      content:
        `⚠️ I can't post in <#${draft.postChannelId}> — I'm missing **${missing.join(", ")}** there.\n` +
        `Right-click the channel → Edit Channel → Permissions → allow my bot/role those, then click **Publish** again.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.update({ content: "Creating raffle…", embeds: [], components: [] });
  takePending(nonce);

  try {
    const raffle = await createRaffle({
      guildId: draft.guildId,
      createdById: draft.createdById,
      projectName: draft.projectName,
      title: draft.title,
      description: draft.description,
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
      hideEntries: draft.hideEntries,
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
        "Pick where to post it, the network(s), and who can enter, then **Publish**.",
        "_Proof is delivered to your configured proof channel (`/config channels`), or the post channel._",
      ].join("\n"),
    )
    .addFields(
      { name: "Post in", value: draft.postChannelId ? `<#${draft.postChannelId}>` : "_choose below_", inline: true },
      { name: "Announce", value: draft.announceChannelId ? `<#${draft.announceChannelId}>` : "_= post channel_", inline: true },
      {
        name: "Network(s)",
        value: draft.walletChains.map(chainLabel).join(", ") || "Ethereum",
        inline: true,
      },
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
      {
        name: "Extras",
        value: extrasSummary(draft),
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

  const chainsSelect = new StringSelectMenuBuilder()
    .setCustomId(buildId(Actions.RaffleSetChains, nonce))
    .setPlaceholder("Network(s) to collect wallets for")
    .setMinValues(1)
    .setMaxValues(ALL_CHAINS.length)
    .addOptions(
      ALL_CHAINS.map((c) => ({
        label: chainLabel(c),
        value: c,
        default: draft.walletChains.includes(c),
      })),
    );

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
      .setCustomId(buildId(Actions.RaffleToggleHide, nonce))
      .setLabel(draft.hideEntries ? "Entries: Hidden" : "Entries: Shown")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.RaffleMoreOptions, nonce))
      .setLabel("More options")
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
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(chainsSelect),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
      buttons,
    ],
  };
}

function expired(
  interaction:
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction,
) {
  return interaction.update({
    content: "This setup expired. Run `/raffle create` again.",
    embeds: [],
    components: [],
  });
}
