import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { RaffleStatus, RoleMatchMode } from "@kos/db";
import { KOS, statusColor, statusBadge } from "../theme.js";
import { buildId, Actions } from "../utils/ids.js";
import { discordFull, discordRelative, formatCountdown } from "../utils/time.js";
import { parseRequirements } from "../services/eligibilityService.js";

export interface RaffleEmbedData {
  id: number;
  projectName: string;
  title: string;
  description: string | null;
  spots: number;
  status: RaffleStatus;
  roleMatchMode: RoleMatchMode;
  startAt: Date;
  endAt: Date;
  entryCount: number;
  hideEntries: boolean;
  bannerUrl: string | null;
  externalUrl: string | null;
  requirements: unknown;
  eligibleRoles: { roleId: string; roleName: string }[];
}

/** Build the premium KOS raffle embed for a raffle's current state. */
export function buildRaffleEmbed(raffle: RaffleEmbedData): EmbedBuilder {
  const rolesText =
    raffle.eligibleRoles.length === 0
      ? "Everyone"
      : raffle.eligibleRoles
          .map((r) => `${KOS.emoji.role} <@&${r.roleId}>`)
          .join("\n");

  const matchHint =
    raffle.eligibleRoles.length > 1
      ? raffle.roleMatchMode === RoleMatchMode.ALL
        ? " · must hold **all**"
        : " · **any** qualifies"
      : "";

  const countdown =
    raffle.status === RaffleStatus.LIVE
      ? `${KOS.emoji.clock} Ends ${discordRelative(raffle.endAt)} · \`${formatCountdown(raffle.endAt)}\` left`
      : raffle.status === RaffleStatus.UPCOMING
        ? `${KOS.emoji.clock} Opens ${discordRelative(raffle.startAt)}`
        : `${KOS.emoji.clock} Closed ${discordRelative(raffle.endAt)}`;

  // Project name is the big headline (H1 in the description renders larger than
  // a normal embed title). The raffle title (e.g. GTD / FCFS) is small subtext.
  const head: string[] = [
    `# ${raffle.projectName.toUpperCase()}`,
    `-# ${raffle.title}`,
  ];
  if (raffle.externalUrl) head.push(`-# [Visit project ↗](${raffle.externalUrl})`);
  if (raffle.description) head.push("", raffle.description.slice(0, 1500));
  head.push("", `**Status** — ${statusBadge(raffle.status)}`, countdown);

  const embed = new EmbedBuilder()
    .setColor(statusColor(raffle.status))
    .setDescription(head.join("\n"))
    .setFooter({
      text: `${KOS.footer} · Raffle #${raffle.id}`,
      ...(KOS.logoUrl ? { iconURL: KOS.logoUrl } : {}),
    })
    .setTimestamp(new Date());

  embed.addFields({
    name: `${KOS.emoji.spot} WL Spots`,
    value: `**${raffle.spots}**`,
    inline: true,
  });
  if (!raffle.hideEntries) {
    embed.addFields(
      { name: "Entries", value: `**${raffle.entryCount}**`, inline: true },
      {
        name: "Odds",
        value:
          raffle.entryCount > 0
            ? `~${Math.min(100, Math.round((raffle.spots / raffle.entryCount) * 100))}%`
            : "—",
        inline: true,
      },
    );
  }
  embed.addFields(
    { name: `Eligible Roles${matchHint}`, value: rolesText, inline: false },
    { name: "Start", value: discordFull(raffle.startAt), inline: true },
    { name: "End", value: discordFull(raffle.endAt), inline: true },
  );

  const tasks = parseRequirements(raffle.requirements).tasks ?? [];
  const textTasks = tasks.filter((t) => !t.url);
  const hasLinkTasks = tasks.some((t) => t.url);
  if (tasks.length > 0) {
    const lines: string[] = [];
    for (const t of textTasks) lines.push(`• ${t.label}`);
    if (hasLinkTasks) lines.push("• Use the buttons below");
    lines.push("", "Then click **Enter Giveaway**.");
    embed.addFields({
      name: `${KOS.emoji.check} Tasks to qualify`,
      value: lines.join("\n").slice(0, 1024),
      inline: false,
    });
  }

  const reqLines = describeRequirements(raffle.requirements);
  if (reqLines) {
    embed.addFields({ name: "Entry Requirements", value: reqLines, inline: false });
  }

  if (raffle.bannerUrl) embed.setImage(raffle.bannerUrl);

  return embed;
}

/**
 * All components for a live raffle message:
 *  - Row 1: Enter / Leave (interactive; disabled when not LIVE).
 *  - Row 2: task link-buttons (Follow / Like / Retweet / Join …) if any.
 */
export function buildRaffleComponents(
  raffle: RaffleEmbedData,
): ActionRowBuilder<ButtonBuilder>[] {
  const live = raffle.status === RaffleStatus.LIVE;
  const enterLabel =
    raffle.status === RaffleStatus.LIVE
      ? "Enter Giveaway"
      : raffle.status === RaffleStatus.UPCOMING
        ? "Not Started Yet"
        : "Raffle Ended";
  const rows: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId(Actions.EnterRaffle, raffle.id))
        .setLabel(enterLabel)
        .setStyle(ButtonStyle.Success)
        .setDisabled(!live),
      new ButtonBuilder()
        .setCustomId(buildId(Actions.LeaveRaffle, raffle.id))
        .setLabel("Leave")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!live),
    ),
  ];

  // Link tasks become buttons (max 5 in one row). Text-only tasks are shown in
  // the embed instead.
  const linkTasks = (parseRequirements(raffle.requirements).tasks ?? [])
    .filter((t): t is { label: string; url: string } => Boolean(t.url))
    .slice(0, 5);
  if (linkTasks.length > 0) {
    const taskRow = new ActionRowBuilder<ButtonBuilder>();
    for (const t of linkTasks) {
      taskRow.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(t.label.slice(0, 40))
          .setURL(t.url),
      );
    }
    rows.push(taskRow);
  }

  return rows;
}

function describeRequirements(raw: unknown): string | null {
  const req = parseRequirements(raw);
  const lines: string[] = [];
  if (req.minAccountAgeDays)
    lines.push(`• Account age ≥ ${req.minAccountAgeDays}d`);
  if (req.minServerAgeDays)
    lines.push(`• In server ≥ ${req.minServerAgeDays}d`);
  if (req.minMessages) lines.push(`• ≥ ${req.minMessages} messages`);
  if (req.requiredRoleIds?.length)
    lines.push(`• Required roles: ${req.requiredRoleIds.map((r) => `<@&${r}>`).join(", ")}`);
  if (req.requiredReaction)
    lines.push(`• React on the announcement post`);
  return lines.length ? lines.join("\n") : null;
}
