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
  spots: number;
  status: RaffleStatus;
  roleMatchMode: RoleMatchMode;
  startAt: Date;
  endAt: Date;
  entryCount: number;
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

  const embed = new EmbedBuilder()
    .setColor(statusColor(raffle.status))
    .setAuthor({ name: raffle.projectName })
    .setTitle(`${KOS.emoji.diamond} ${raffle.title}`)
    .setDescription(
      [
        `**Status** — ${statusBadge(raffle.status)}`,
        countdown,
      ].join("\n"),
    )
    .addFields(
      {
        name: `${KOS.emoji.spot} WL Spots`,
        value: `**${raffle.spots}**`,
        inline: true,
      },
      {
        name: "Entries",
        value: `**${raffle.entryCount}**`,
        inline: true,
      },
      {
        name: "Odds",
        value:
          raffle.entryCount > 0
            ? `~${Math.min(100, Math.round((raffle.spots / raffle.entryCount) * 100))}%`
            : "—",
        inline: true,
      },
      {
        name: `Eligible Roles${matchHint}`,
        value: rolesText,
        inline: false,
      },
      {
        name: "Start",
        value: discordFull(raffle.startAt),
        inline: true,
      },
      {
        name: "End",
        value: discordFull(raffle.endAt),
        inline: true,
      },
    )
    .setFooter({
      text: `${KOS.footer} · Raffle #${raffle.id}`,
      ...(KOS.logoUrl ? { iconURL: KOS.logoUrl } : {}),
    })
    .setTimestamp(new Date());

  const tasks = parseRequirements(raffle.requirements).tasks ?? [];
  if (tasks.length > 0) {
    embed.addFields({
      name: `${KOS.emoji.check} Tasks to qualify`,
      value: tasks.map((t) => `• [${t.label}](${t.url})`).join("\n").slice(0, 1024),
      inline: false,
    });
  }

  const reqLines = describeRequirements(raffle.requirements);
  if (reqLines) {
    embed.addFields({ name: "Entry Requirements", value: reqLines, inline: false });
  }

  if (raffle.bannerUrl) embed.setImage(raffle.bannerUrl);
  if (raffle.externalUrl) embed.setURL(raffle.externalUrl);

  return embed;
}

/** Enter / Leave buttons; disabled when the raffle is not LIVE. */
export function buildRaffleButtons(
  raffleId: number,
  status: RaffleStatus,
): ActionRowBuilder<ButtonBuilder> {
  const live = status === RaffleStatus.LIVE;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(Actions.EnterRaffle, raffleId))
      .setLabel("Enter Raffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(KOS.emoji.spot)
      .setDisabled(!live),
    new ButtonBuilder()
      .setCustomId(buildId(Actions.LeaveRaffle, raffleId))
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!live),
  );
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
