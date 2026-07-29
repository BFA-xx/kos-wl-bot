import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { VerificationLogStatus, prisma } from "@kos/db";
import { logger } from "../logger.js";
import { KOS } from "../theme.js";

interface VerificationLogInput {
  client: Client;
  guild: Guild;
  userId: string;
  success: boolean;
  codeId?: string | null;
  code?: string | null;
  reason?: string | null;
  roleIds?: string[];
  rulesAcceptedAt?: Date | null;
}

/**
 * Write the durable verification audit row and, when configured, mirror a
 * polished event embed to the server's private log channel. Logging failures
 * never break member onboarding.
 */
export async function logVerification(
  input: VerificationLogInput,
): Promise<void> {
  const status = input.success
    ? VerificationLogStatus.SUCCESS
    : VerificationLogStatus.FAILURE;
  try {
    await prisma.verificationLog.create({
      data: {
        guildId: input.guild.id,
        userId: input.userId,
        codeId: input.codeId ?? null,
        code: input.code ?? null,
        status,
        reason: input.reason?.slice(0, 1000) ?? null,
        roleIds: [...new Set(input.roleIds ?? [])],
        rulesAcceptedAt: input.rulesAcceptedAt ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { error, guildId: input.guild.id, userId: input.userId },
      "failed to persist verification log",
    );
  }

  try {
    const settings = await prisma.verificationSettings.findUnique({
      where: { guildId: input.guild.id },
      select: { logChannelId: true },
    });
    if (!settings?.logChannelId) return;
    const channel = await input.client.channels
      .fetch(settings.logChannelId)
      .catch(() => null);
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      !("send" in channel)
    ) {
      return;
    }

    const roles = input.roleIds?.length
      ? input.roleIds.map((id) => `<@&${id}>`).join(", ")
      : "None";
    const embed = new EmbedBuilder()
      .setColor(input.success ? KOS.colors.success : KOS.colors.danger)
      .setTitle(
        input.success
          ? `${KOS.emoji.check} Member Verified`
          : `${KOS.emoji.cross} Verification Failed`,
      )
      .addFields(
        { name: "Member", value: `<@${input.userId}>`, inline: true },
        {
          name: "Code",
          value: input.code ? `\`${input.code}\`` : "Not required",
          inline: true,
        },
        { name: "Roles Granted", value: roles.slice(0, 1024) },
      )
      .setTimestamp()
      .setFooter({ text: KOS.footer });
    if (input.reason) {
      embed.addFields({
        name: input.success ? "Details" : "Reason",
        value: input.reason.slice(0, 1024),
      });
    }
    if (input.rulesAcceptedAt) {
      embed.addFields({
        name: "Rules Accepted",
        value: `<t:${Math.floor(input.rulesAcceptedAt.getTime() / 1000)}:F>`,
      });
    }
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn(
      { error, guildId: input.guild.id, userId: input.userId },
      "failed to publish verification log",
    );
  }
}
