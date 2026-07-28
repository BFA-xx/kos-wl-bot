import {
  EmbedBuilder,
  type Client,
  type MessageCreateOptions,
} from "discord.js";
import { PingMentionMode, PingStatus, prisma, type Ping } from "@kos/db";
import { KOS } from "../theme.js";
import { logger } from "../logger.js";

const STALE_SENDING_MS = 5 * 60_000;

export interface PingMentionPayload {
  content?: string;
  allowedMentions: NonNullable<MessageCreateOptions["allowedMentions"]>;
}

export function pingMentionPayload(
  mode: PingMentionMode,
  roleIds: string[],
): PingMentionPayload {
  if (mode === PingMentionMode.HERE) {
    return {
      content: "@here",
      allowedMentions: { parse: ["everyone"] },
    };
  }
  if (mode === PingMentionMode.EVERYONE) {
    return {
      content: "@everyone",
      allowedMentions: { parse: ["everyone"] },
    };
  }
  if (mode === PingMentionMode.ROLES) {
    return {
      content: roleIds.map((id) => `<@&${id}>`).join(" "),
      allowedMentions: { parse: [], roles: roleIds },
    };
  }
  return { allowedMentions: { parse: [] } };
}

/** Claim and deliver due dashboard pings through the connected Discord client. */
export async function processPingQueue(
  client: Client,
  now: Date,
  batchSize: number,
): Promise<void> {
  await prisma.ping.updateMany({
    where: {
      status: PingStatus.SENDING,
      sendingAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) },
      messageId: null,
    },
    data: {
      status: PingStatus.SCHEDULED,
      sendingAt: null,
      failureReason: "Recovered after an interrupted delivery attempt.",
    },
  });
  const due = await prisma.ping.findMany({
    where: {
      status: PingStatus.SCHEDULED,
      scheduledAt: { lte: now },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: batchSize,
  });
  for (const ping of due) {
    const claimed = await prisma.ping.updateMany({
      where: { id: ping.id, status: PingStatus.SCHEDULED },
      data: {
        status: PingStatus.SENDING,
        sendingAt: new Date(),
        failureReason: null,
      },
    });
    if (claimed.count === 0) continue;
    await deliverPing(client, ping).catch(async (err) => {
      const reason =
        err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
      logger.error({ err, pingId: ping.id }, "scheduled ping delivery failed");
      await prisma.ping
        .update({
          where: { id: ping.id },
          data: {
            status: PingStatus.FAILED,
            sendingAt: null,
            failureReason: reason,
          },
        })
        .catch(() => undefined);
    });
  }
}

function buildPingEmbed(ping: Ping): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(KOS.colors.live)
    .setTitle(ping.title)
    .setDescription(ping.message)
    .setFooter({ text: KOS.footer })
    .setTimestamp();
  if (ping.linkUrl) {
    embed.addFields({ name: "Open", value: `[View link](${ping.linkUrl})` });
  }
  return embed;
}

async function deliverPing(client: Client, ping: Ping): Promise<void> {
  const guild = await client.guilds.fetch(ping.guildId);
  if (ping.mentionMode === PingMentionMode.ROLES) {
    const roles = await guild.roles.fetch();
    const missing = ping.roleIds.filter((id) => {
      const role = roles.get(id);
      return !role || role.id === guild.id || role.managed;
    });
    if (missing.length > 0)
      throw new Error("One or more selected mention roles no longer exist.");
  }
  const channel = await guild.channels.fetch(ping.channelId);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("send" in channel)
  ) {
    throw new Error("The configured ping channel is unavailable.");
  }
  const mention = pingMentionPayload(ping.mentionMode, ping.roleIds);
  const message = await channel.send({
    ...mention,
    embeds: [buildPingEmbed(ping)],
    nonce: ping.id,
    enforceNonce: true,
  });
  await prisma.ping.update({
    where: { id: ping.id },
    data: {
      status: PingStatus.SENT,
      sendingAt: null,
      sentAt: new Date(),
      messageId: message.id,
      failureReason: null,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        organizationId: ping.organizationId,
        actorId: null,
        action: "PING_SENT",
        targetType: "ping",
        targetId: ping.id,
        metadata: {
          guildId: ping.guildId,
          channelId: ping.channelId,
          mentionMode: ping.mentionMode,
        },
      },
    })
    .catch(() => undefined);
}
