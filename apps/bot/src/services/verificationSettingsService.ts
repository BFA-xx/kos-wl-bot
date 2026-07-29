import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type NonThreadGuildBasedChannel,
} from "discord.js";
import { prisma, type Prisma, type VerificationSettings } from "@kos/db";
import { logger } from "../logger.js";
import { buildVerificationWelcomeMessage } from "../embeds/verificationEmbed.js";

const MANAGED_CHANNEL_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildCategory,
]);

export class VerificationSettingsError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "VerificationSettingsError";
  }
}

export async function getOrCreateVerificationSettings(
  guildId: string,
): Promise<VerificationSettings> {
  return prisma.verificationSettings.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}

export async function updateVerificationSettings(
  guildId: string,
  data: Prisma.VerificationSettingsUpdateInput,
): Promise<VerificationSettings> {
  await getOrCreateVerificationSettings(guildId);
  return prisma.verificationSettings.update({
    where: { guildId },
    data,
  });
}

export async function ensureUnverifiedRole(
  guild: Guild,
): Promise<{ settings: VerificationSettings; created: boolean }> {
  let settings = await getOrCreateVerificationSettings(guild.id);
  if (settings.unverifiedRoleId) {
    const existing =
      guild.roles.cache.get(settings.unverifiedRoleId) ??
      (await guild.roles.fetch(settings.unverifiedRoleId).catch(() => null));
    if (existing) return { settings, created: false };
  }

  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new VerificationSettingsError(
      "KOS needs Manage Roles before it can create the Unverified role.",
      ["Grant KOS the Manage Roles permission."],
    );
  }
  const role = await guild.roles.create({
    name: "Unverified",
    permissions: [],
    reason: "KOS verification onboarding",
  });
  settings = await updateVerificationSettings(guild.id, {
    unverifiedRoleId: role.id,
  });
  return { settings, created: true };
}

export function visibleVerificationChannelIds(
  settings: Pick<
    VerificationSettings,
    "allowedChannelIds" | "verificationChannelId" | "rulesChannelId"
  >,
): Set<string> {
  return new Set(
    [
      ...settings.allowedChannelIds,
      settings.verificationChannelId,
      settings.rulesChannelId,
    ].filter((id): id is string => Boolean(id)),
  );
}

/**
 * Apply or remove the View Channel overwrite owned by verification. No
 * @everyone overwrite is touched, and unrelated permissions on the role's
 * existing overwrite are preserved.
 */
export async function syncVerificationChannelAccess(
  guild: Guild,
  settings?: VerificationSettings,
): Promise<{ changed: number; skipped: number }> {
  const current = settings ?? (await getOrCreateVerificationSettings(guild.id));
  if (!current.unverifiedRoleId) {
    throw new VerificationSettingsError(
      "Choose or create an Unverified role first.",
      ["Unverified role is not configured."],
    );
  }
  const role =
    guild.roles.cache.get(current.unverifiedRoleId) ??
    (await guild.roles.fetch(current.unverifiedRoleId).catch(() => null));
  if (!role) {
    throw new VerificationSettingsError(
      "The configured Unverified role no longer exists.",
      ["Choose a new Unverified role."],
    );
  }
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new VerificationSettingsError(
      "KOS needs Manage Channels to protect verification-only access.",
      ["Grant KOS the Manage Channels permission."],
    );
  }

  const allowed = visibleVerificationChannelIds(current);
  const channels = await guild.channels.fetch();
  const manageable = [...channels.values()].filter(
    (channel): channel is NonThreadGuildBasedChannel =>
      Boolean(channel && MANAGED_CHANNEL_TYPES.has(channel.type)),
  );

  let changed = 0;
  let skipped = 0;
  for (let offset = 0; offset < manageable.length; offset += 5) {
    await Promise.all(
      manageable.slice(offset, offset + 5).map(async (channel) => {
        const desired = current.enabled ? allowed.has(channel.id) : null;
        try {
          await channel.permissionOverwrites.edit(
            role,
            { ViewChannel: desired },
            {
              reason: current.enabled
                ? "KOS verification access sync"
                : "KOS verification disabled",
            },
          );
          changed += 1;
        } catch (error) {
          skipped += 1;
          logger.warn(
            { error, guildId: guild.id, channelId: channel.id },
            "verification channel overwrite failed",
          );
        }
      }),
    );
  }

  if (skipped > 0) {
    throw new VerificationSettingsError(
      `Updated ${changed} channels, but ${skipped} could not be changed.`,
      [
        "Check KOS channel-specific permissions and move its role above protected channel roles if needed.",
      ],
    );
  }
  return { changed, skipped };
}

export async function clearVerificationRoleAccess(
  guild: Guild,
  roleId: string,
): Promise<void> {
  const channels = await guild.channels.fetch();
  const manageable = [...channels.values()].filter(
    (channel): channel is NonThreadGuildBasedChannel =>
      Boolean(channel && MANAGED_CHANNEL_TYPES.has(channel.type)),
  );
  for (let offset = 0; offset < manageable.length; offset += 5) {
    await Promise.all(
      manageable
        .slice(offset, offset + 5)
        .map((channel) =>
          channel.permissionOverwrites.edit(
            roleId,
            { ViewChannel: null },
            { reason: "KOS verification role changed" },
          ),
        ),
    );
  }
}

export async function applyVerificationAccessToNewChannel(
  channel: GuildBasedChannel,
): Promise<void> {
  if (channel.isThread() || !MANAGED_CHANNEL_TYPES.has(channel.type)) return;
  const settings = await prisma.verificationSettings.findUnique({
    where: { guildId: channel.guild.id },
  });
  if (!settings?.enabled || !settings.unverifiedRoleId) return;
  const allowed = visibleVerificationChannelIds(settings);
  await channel.permissionOverwrites.edit(
    settings.unverifiedRoleId,
    { ViewChannel: allowed.has(channel.id) },
    { reason: "KOS verification access for new channel" },
  );
}

export async function verificationReadinessIssues(
  guild: Guild,
  settings?: VerificationSettings,
): Promise<string[]> {
  const current = settings ?? (await getOrCreateVerificationSettings(guild.id));
  const issues: string[] = [];
  if (!current.verificationChannelId) {
    issues.push("Choose a verification channel.");
  }
  if (!current.unverifiedRoleId) {
    issues.push("Choose or create an Unverified role.");
  }
  if (current.requireRulesAcceptance && !current.rulesChannelId) {
    issues.push("Rules acceptance is on, but no rules channel is selected.");
  }
  const availableCodes = current.requireCode
    ? await prisma.verificationCode.findMany({
        where: {
          guildId: guild.id,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
          roleIds: true,
          maxUses: true,
          uses: true,
        },
      })
    : [];
  const usableCodes = availableCodes.filter(
    (code) => code.maxUses === null || code.uses < code.maxUses,
  );
  if (current.requireCode && usableCodes.length === 0) {
    issues.push(
      "Code verification is required, but no active code has uses available.",
    );
  }

  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    issues.push("KOS could not resolve its server member.");
    return issues;
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    issues.push("KOS is missing Manage Roles.");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    issues.push("KOS is missing Manage Channels.");
  }

  if (current.unverifiedRoleId) {
    const role =
      guild.roles.cache.get(current.unverifiedRoleId) ??
      (await guild.roles.fetch(current.unverifiedRoleId).catch(() => null));
    if (!role) {
      issues.push("The configured Unverified role was deleted.");
    } else if (!role.editable) {
      issues.push("Move the KOS bot role above the Unverified role.");
    }
  }
  for (const roleId of current.defaultRoleIds) {
    const role =
      guild.roles.cache.get(roleId) ??
      (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      issues.push(`A configured verified role (${roleId}) was deleted.`);
    } else if (!role.editable) {
      issues.push(`Move the KOS bot role above @${role.name}.`);
    }
  }
  const codeRoleIds = [...new Set(usableCodes.flatMap((code) => code.roleIds))];
  for (const roleId of codeRoleIds) {
    const role =
      guild.roles.cache.get(roleId) ??
      (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      issues.push(`A role attached to an active code (${roleId}) was deleted.`);
    } else if (!role.editable) {
      issues.push(`Move the KOS bot role above @${role.name}.`);
    }
  }

  if (current.verificationChannelId) {
    const channel = await guild.channels
      .fetch(current.verificationChannelId)
      .catch(() => null);
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      !("send" in channel)
    ) {
      issues.push(
        "The verification channel is unavailable or cannot receive messages.",
      );
    } else {
      const permissions = channel.permissionsFor(botMember);
      const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ];
      if (required.some((permission) => !permissions?.has(permission))) {
        issues.push(
          "KOS needs View Channel, Send Messages, Embed Links, and Read Message History in the verification channel.",
        );
      }
    }
  }
  if (current.logChannelId) {
    const channel = await guild.channels
      .fetch(current.logChannelId)
      .catch(() => null);
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.isDMBased() ||
      !botMember ||
      !channel
        .permissionsFor(botMember)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
    ) {
      issues.push(
        "KOS needs View Channel, Send Messages, and Embed Links in the verification log channel.",
      );
    }
  }
  return [...new Set(issues)];
}

export async function setVerificationEnabled(
  guild: Guild,
  enabled: boolean,
): Promise<VerificationSettings> {
  let settings = await getOrCreateVerificationSettings(guild.id);
  if (enabled) {
    ({ settings } = await ensureUnverifiedRole(guild));
    const issues = await verificationReadinessIssues(guild, settings);
    if (issues.length > 0) {
      throw new VerificationSettingsError(
        "Verification is not ready to enable.",
        issues,
      );
    }
  }
  const updated = await updateVerificationSettings(guild.id, { enabled });
  try {
    await syncVerificationChannelAccess(guild, updated);
  } catch (error) {
    if (enabled) {
      await updateVerificationSettings(guild.id, { enabled: false });
    }
    throw error;
  }
  return updated;
}

export async function publishVerificationPanel(
  guild: Guild,
): Promise<{ messageId: string; updated: boolean }> {
  const settings = await getOrCreateVerificationSettings(guild.id);
  const issues = await verificationReadinessIssues(guild, settings);
  if (issues.length > 0) {
    throw new VerificationSettingsError(
      "The verification panel is not ready to publish.",
      issues,
    );
  }
  const channel = await guild.channels
    .fetch(settings.verificationChannelId!)
    .catch(() => null);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("send" in channel) ||
    !("messages" in channel)
  ) {
    throw new VerificationSettingsError(
      "The selected verification channel cannot receive the panel.",
    );
  }

  const payload = buildVerificationWelcomeMessage(settings);
  if (settings.panelMessageId) {
    const existing = await channel.messages
      .fetch(settings.panelMessageId)
      .catch(() => null);
    if (existing) {
      await existing.edit(payload);
      await updateVerificationSettings(guild.id, {
        panelPublishedAt: new Date(),
      });
      return { messageId: existing.id, updated: true };
    }
  }

  const message = await channel.send(payload);
  await updateVerificationSettings(guild.id, {
    panelMessageId: message.id,
    panelPublishedAt: new Date(),
  });
  return { messageId: message.id, updated: false };
}

export async function refreshPublishedVerificationPanel(
  client: Client,
  guildId: string,
): Promise<void> {
  const settings = await prisma.verificationSettings.findUnique({
    where: { guildId },
  });
  if (!settings?.panelMessageId || !settings.verificationChannelId) {
    return;
  }
  const channel = await client.channels
    .fetch(settings.verificationChannelId)
    .catch(() => null);
  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    !("messages" in channel)
  ) {
    return;
  }
  const message = await channel.messages
    .fetch(settings.panelMessageId)
    .catch(() => null);
  if (!message) return;
  await message.edit(buildVerificationWelcomeMessage(settings));
}
