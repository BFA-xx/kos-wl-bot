import { EmbedBuilder } from "discord.js";
import { KOS } from "../theme.js";
import { humanDuration, discordFull } from "../utils/time.js";

export interface ProofEmbedData {
  id: number;
  projectName: string;
  startAt: Date;
  endAt: Date;
  entryCount: number;
  winnerCount: number;
  messageLink: string | null;
  drawSeedHash: string | null;
}

/** "✅ WL Raffle Completed" proof delivery embed. */
export function buildProofEmbed(data: ProofEmbedData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.silver)
    .setAuthor({ name: data.projectName })
    .setTitle(`${KOS.emoji.check} WL Raffle Completed`)
    .addFields(
      { name: "Raffle ID", value: `#${data.id}`, inline: true },
      {
        name: "Duration",
        value: humanDuration(data.startAt, data.endAt),
        inline: true,
      },
      { name: "Entries", value: `${data.entryCount}`, inline: true },
      { name: "Winners", value: `${data.winnerCount}`, inline: true },
      { name: "Start", value: discordFull(data.startAt), inline: true },
      { name: "End", value: discordFull(data.endAt), inline: true },
    )
    .setFooter({
      text: `${KOS.footer} · Verifiable Proof`,
      ...(KOS.logoUrl ? { iconURL: KOS.logoUrl } : {}),
    })
    .setTimestamp(new Date());

  const extra: string[] = [];
  if (data.messageLink) extra.push(`[Announcement message](${data.messageLink})`);
  if (data.drawSeedHash)
    extra.push(`Draw commitment: \`${data.drawSeedHash.slice(0, 32)}…\``);
  if (extra.length) {
    embed.setDescription(extra.join("\n"));
  }

  embed.addFields({
    name: "Attachments",
    value: "• PDF Report\n• Winner CSV\n• Winner Card (PNG)",
  });

  return embed;
}
