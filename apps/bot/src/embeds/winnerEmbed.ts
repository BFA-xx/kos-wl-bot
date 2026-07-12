import { EmbedBuilder } from "discord.js";
import { KOS } from "../theme.js";
import { discordFull } from "../utils/time.js";

export interface WinnerEmbedData {
  id: number;
  communityName: string;
  projectName: string;
  title: string;
  spots: number;
  entryCount?: number;
  endedAt: Date;
  winners: { userId: string; username: string }[];
  drawSeedHash: string | null;
}

/** Winner announcement embed branded for the community and project. */
export function buildWinnerEmbed(data: WinnerEmbedData): EmbedBuilder {
  const winnerList =
    data.winners.length === 0
      ? "_No eligible entries — no winners drawn._"
      : data.winners.map((w, i) => `\`${i + 1}.\` <@${w.userId}>`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(KOS.colors.white)
    .setAuthor({ name: data.communityName })
    .setTitle(
      `${KOS.emoji.trophy} ${data.communityName} × ${data.projectName} — WL Raffle Finished`.slice(
        0,
        256,
      ),
    )
    .setDescription(
      [
        `**${data.title}**`,
        "",
        `${KOS.emoji.spot} **WL Spots:** ${data.spots}`,
        ...(data.entryCount === undefined
          ? []
          : [`**Entries:** ${data.entryCount}`]),
        `**Closed:** ${discordFull(data.endedAt)}`,
      ].join("\n"),
    )
    .addFields({
      name: `Winners (${data.winners.length})`,
      value: winnerList,
    })
    .setFooter({
      text: `${KOS.footer} · Raffle #${data.id}`,
      ...(KOS.logoUrl ? { iconURL: KOS.logoUrl } : {}),
    })
    .setTimestamp(new Date());

  if (data.drawSeedHash) {
    embed.addFields({
      name: "Verification",
      value: `Draw commitment \`${data.drawSeedHash.slice(0, 24)}…\``,
    });
  }

  return embed;
}

/** Plain-text mention line so winners get a real ping. */
export function buildWinnerMentions(winners: { userId: string }[]): string {
  if (winners.length === 0) return "";
  return `Congratulations ${winners.map((w) => `<@${w.userId}>`).join(" ")} 🎉`;
}
