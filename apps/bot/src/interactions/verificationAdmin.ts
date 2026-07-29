import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
  type Guild,
} from "discord.js";
import {
  prisma,
  type VerificationCode,
  type VerificationSettings,
} from "@kos/db";
import { KOS } from "../theme.js";
import { Actions, buildId } from "../utils/ids.js";
import {
  getOrCreateVerificationSettings,
  verificationReadinessIssues,
  visibleVerificationChannelIds,
} from "../services/verificationSettingsService.js";

export async function buildVerificationAdminPanel(
  guild: Guild,
): Promise<BaseMessageOptions> {
  const settings = await getOrCreateVerificationSettings(guild.id);
  const [codeCount, issues] = await Promise.all([
    prisma.verificationCode.count({ where: { guildId: guild.id } }),
    verificationReadinessIssues(guild, settings),
  ]);
  const status = settings.enabled ? "Enabled" : "Disabled";
  const roleMentions = settings.defaultRoleIds.length
    ? settings.defaultRoleIds.map((id) => `<@&${id}>`).join(", ")
    : "No default role";
  const allowed = visibleVerificationChannelIds(settings);
  const embed = new EmbedBuilder()
    .setColor(settings.enabled ? KOS.colors.success : KOS.colors.grey)
    .setTitle(`${KOS.emoji.diamond} KOS Verification`)
    .setDescription(
      "Configure the complete member onboarding flow here. Changes are private until you publish or update the verification panel.",
    )
    .addFields(
      {
        name: "Status",
        value: `**${status}**${settings.panelMessageId ? " · Panel published" : " · Panel not published"}`,
        inline: true,
      },
      {
        name: "Flow",
        value: [
          `Code: **${settings.requireCode ? "Required" : "Skipped"}**`,
          `Rules: **${settings.requireRulesAcceptance ? "Required" : "Skipped"}**`,
          `Repeat redemption: **${settings.preventCodeReuse ? "Blocked" : "Allowed"}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Codes",
        value: `**${codeCount}** configured`,
        inline: true,
      },
      {
        name: "Channels",
        value: [
          `Verification: ${mentionChannel(settings.verificationChannelId)}`,
          `Rules: ${mentionChannel(settings.rulesChannelId)}`,
          `Logs: ${mentionChannel(settings.logChannelId)}`,
          `Visible while unverified: **${allowed.size}**`,
        ].join("\n"),
      },
      {
        name: "Roles",
        value: [
          `Unverified: ${mentionRole(settings.unverifiedRoleId)}`,
          `After verification: ${roleMentions}`,
        ].join("\n"),
      },
      {
        name: issues.length ? "Setup Checks" : "Setup Checks",
        value: issues.length
          ? issues
              .map((issue) => `⚠️ ${issue}`)
              .join("\n")
              .slice(0, 1024)
          : "✅ Channels, roles, and bot permissions are ready.",
      },
    )
    .setFooter({
      text: `${KOS.footer} · Use /verification code to manage access codes`,
    });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationToggle, "enabled"))
          .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
          .setLabel(settings.enabled ? "Disable" : "Enable"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationToggle, "code"))
          .setStyle(
            settings.requireCode ? ButtonStyle.Primary : ButtonStyle.Secondary,
          )
          .setLabel(`Require Code: ${settings.requireCode ? "On" : "Off"}`),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationToggle, "rules"))
          .setStyle(
            settings.requireRulesAcceptance
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary,
          )
          .setLabel(
            `Require Rules: ${settings.requireRulesAcceptance ? "On" : "Off"}`,
          ),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationToggle, "reuse"))
          .setStyle(
            settings.preventCodeReuse
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary,
          )
          .setLabel(
            `Member Reuse: ${settings.preventCodeReuse ? "Blocked" : "Allowed"}`,
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationEditWelcome))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Welcome Embed"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationEditModal))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Verification Modal"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationEditMessages))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Success & Failure"),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationAdminChannels))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Channels"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationAdminRoles))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Roles"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationSyncAccess))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Sync Access"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationPublish))
          .setStyle(ButtonStyle.Primary)
          .setLabel(settings.panelMessageId ? "Update Panel" : "Publish Panel"),
      ),
    ],
  };
}

export function buildVerificationChannelsPanel(
  settings: VerificationSettings,
): BaseMessageOptions {
  const verificationSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetVerifyChannel))
    .setPlaceholder("Choose the verification channel")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.verificationChannelId) {
    verificationSelect.setDefaultChannels(settings.verificationChannelId);
  }

  const rulesSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetRulesChannel))
    .setPlaceholder("Choose the rules channel")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.rulesChannelId) {
    rulesSelect.setDefaultChannels(settings.rulesChannelId);
  }

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetLogChannel))
    .setPlaceholder("Choose the private verification log channel")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.logChannelId) {
    logSelect.setDefaultChannels(settings.logChannelId);
  }

  const allowedSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetAllowedChannels))
    .setPlaceholder("Choose any extra channels visible before verification")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(10);
  if (settings.allowedChannelIds.length) {
    allowedSelect.setDefaultChannels(
      ...settings.allowedChannelIds.slice(0, 10),
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} Verification Channels`)
        .setDescription(
          "The Verification and Rules channels are always visible to the Unverified role. Add optional Welcome channels below. The log channel remains private unless you explicitly include it.",
        )
        .addFields(
          {
            name: "Verification",
            value: mentionChannel(settings.verificationChannelId),
            inline: true,
          },
          {
            name: "Rules",
            value: mentionChannel(settings.rulesChannelId),
            inline: true,
          },
          {
            name: "Logs",
            value: mentionChannel(settings.logChannelId),
            inline: true,
          },
        )
        .setFooter({ text: KOS.footer }),
    ],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        verificationSelect,
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        rulesSelect,
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(logSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        allowedSelect,
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationAdminPanel))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Back"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationClearSetting, "rules"))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Clear Rules"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationClearSetting, "log"))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Clear Logs"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationClearSetting, "allowed"))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Clear Extra"),
      ),
    ],
  };
}

export function buildVerificationRolesPanel(
  settings: VerificationSettings,
): BaseMessageOptions {
  const unverifiedSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetUnverifiedRole))
    .setPlaceholder("Choose the Unverified role")
    .setMinValues(1)
    .setMaxValues(1);
  if (settings.unverifiedRoleId) {
    unverifiedSelect.setDefaultRoles(settings.unverifiedRoleId);
  }
  const defaultRolesSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationSetDefaultRoles))
    .setPlaceholder("Choose role(s) granted after verification")
    .setMinValues(1)
    .setMaxValues(10);
  if (settings.defaultRoleIds.length) {
    defaultRolesSelect.setDefaultRoles(...settings.defaultRoleIds.slice(0, 10));
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.diamond} Verification Roles`)
        .setDescription(
          "KOS adds Unverified on join, grants the default role(s) plus any code-specific roles, then removes Unverified. Keep the KOS bot role above every managed role.",
        )
        .addFields(
          {
            name: "Unverified Role",
            value: mentionRole(settings.unverifiedRoleId),
          },
          {
            name: "Default Verified Roles",
            value: settings.defaultRoleIds.length
              ? settings.defaultRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "None",
          },
        )
        .setFooter({ text: KOS.footer }),
    ],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        unverifiedSelect,
      ),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        defaultRolesSelect,
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationAdminPanel))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Back"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationClearSetting, "defaults"))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Clear Default Roles"),
      ),
    ],
  };
}

export function buildVerificationCodeModal(
  code?: VerificationCode,
): ModalBuilder {
  const editing = Boolean(code);
  return new ModalBuilder()
    .setCustomId(
      editing
        ? buildId(Actions.VerificationCodeEdit, code!.id)
        : buildId(Actions.VerificationCodeCreate),
    )
    .setTitle(editing ? "Edit Verification Code" : "Create Verification Code")
    .addComponents(
      modalRow(
        withInitialValue(
          new TextInputBuilder()
            .setCustomId("code")
            .setLabel("Code")
            .setPlaceholder("ALPHA")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(32),
          code?.code,
        ),
      ),
      modalRow(
        withInitialValue(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Description")
            .setPlaceholder("Alpha community access")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500),
          code?.description,
        ),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("max_uses")
          .setLabel("Max Uses")
          .setPlaceholder("100 or unlimited")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(16)
          .setValue(
            code?.maxUses === null || !code
              ? "unlimited"
              : String(code.maxUses),
          ),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("expires_at")
          .setLabel("Expiration Date")
          .setPlaceholder("2026-08-01T18:00:00Z or never")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
          .setValue(code?.expiresAt?.toISOString() ?? "never"),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("state")
          .setLabel("Status and Member Reuse")
          .setPlaceholder("active, one-time or inactive, reusable")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setValue(
            code
              ? `${code.active ? "active" : "inactive"}, ${code.oneTimePerMember ? "one-time" : "reusable"}`
              : "active, one-time",
          ),
      ),
    );
}

export function buildVerificationWelcomeModal(
  settings: VerificationSettings,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildId(Actions.VerificationSaveWelcome))
    .setTitle("Edit Verification Welcome")
    .addComponents(
      modalRow(
        new TextInputBuilder()
          .setCustomId("welcome_title")
          .setLabel("Welcome Embed Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(256)
          .setValue(settings.welcomeTitle),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("welcome_description")
          .setLabel("Welcome Embed Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setValue(settings.welcomeDescription),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("button_label")
          .setLabel("Verify Button Label")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setValue(settings.verifyButtonLabel),
      ),
      modalRow(
        withInitialValue(
          new TextInputBuilder()
            .setCustomId("button_emoji")
            .setLabel("Verify Button Emoji")
            .setPlaceholder("Optional: ✅ or a custom emoji")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100),
          settings.verifyButtonEmoji,
        ),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("welcome_color")
          .setLabel("Welcome Embed Colour")
          .setPlaceholder("#C0C0C0")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(7)
          .setValue(`#${settings.welcomeColor.toString(16).padStart(6, "0")}`),
      ),
    );
}

export function buildVerificationModalCopyModal(
  settings: VerificationSettings,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildId(Actions.VerificationSaveModal))
    .setTitle("Edit Verification Modal")
    .addComponents(
      modalRow(
        new TextInputBuilder()
          .setCustomId("modal_title")
          .setLabel("Modal Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(45)
          .setValue(settings.modalTitle),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("field_label")
          .setLabel("Field Label")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(45)
          .setValue(settings.modalFieldLabel),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("placeholder")
          .setLabel("Field Placeholder")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(settings.modalPlaceholder),
      ),
    );
}

export function buildVerificationMessagesModal(
  settings: VerificationSettings,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildId(Actions.VerificationSaveMessages))
    .setTitle("Edit Verification Messages")
    .addComponents(
      modalRow(
        new TextInputBuilder()
          .setCustomId("success_message")
          .setLabel("Success Message")
          .setPlaceholder("Supports {user}, {server}, {code}, and {roles}")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(settings.successMessage),
      ),
      modalRow(
        new TextInputBuilder()
          .setCustomId("failure_message")
          .setLabel("Failure Message")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setValue(settings.failureMessage),
      ),
    );
}

export function buildVerificationCodeRolesPrompt(
  code: VerificationCode,
): BaseMessageOptions {
  const select = new RoleSelectMenuBuilder()
    .setCustomId(buildId(Actions.VerificationCodeRoles, code.id))
    .setPlaceholder("Select role(s) this code grants")
    .setMinValues(1)
    .setMaxValues(10);
  if (code.roleIds.length) {
    select.setDefaultRoles(...code.roleIds.slice(0, 10));
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.silver)
        .setTitle(`${KOS.emoji.check} Code ${code.code} Saved`)
        .setDescription(
          "Choose any extra roles this code should grant. These are added alongside the server's default verified role(s). Use **No Extra Roles** if the code only controls access.",
        )
        .setFooter({ text: KOS.footer }),
    ],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            buildId(Actions.VerificationClearSetting, "code_roles", code.id),
          )
          .setStyle(ButtonStyle.Secondary)
          .setLabel("No Extra Roles"),
      ),
    ],
  };
}

export function buildVerificationCodeDeletePrompt(
  code: VerificationCode,
): BaseMessageOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(KOS.colors.danger)
        .setTitle("Delete Verification Code?")
        .setDescription(
          `Delete **${code.code}**? Historical redemption and verification logs will be preserved. This cannot be undone.`,
        )
        .setFooter({ text: KOS.footer }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationCodeDelete, code.id))
          .setStyle(ButtonStyle.Danger)
          .setLabel("Delete Code"),
        new ButtonBuilder()
          .setCustomId(buildId(Actions.VerificationCodeCancel))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Cancel"),
      ),
    ],
  };
}

function modalRow(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function withInitialValue(
  input: TextInputBuilder,
  value?: string | null,
): TextInputBuilder {
  return value ? input.setValue(value) : input;
}

function mentionChannel(id: string | null): string {
  return id ? `<#${id}>` : "Not configured";
}

function mentionRole(id: string | null): string {
  return id ? `<@&${id}>` : "Not configured";
}
