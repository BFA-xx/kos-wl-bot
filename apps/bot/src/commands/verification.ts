import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { LogCategory } from "@kos/db";
import type { Command } from "../types.js";
import { KOS } from "../theme.js";
import { ensureGuild } from "../services/userService.js";
import { audit } from "../services/auditService.js";
import {
  getVerificationCode,
  listVerificationCodes,
} from "../services/verificationCodeService.js";
import {
  ensureUnverifiedRole,
  publishVerificationPanel,
  VerificationSettingsError,
} from "../services/verificationSettingsService.js";
import {
  buildVerificationAdminPanel,
  buildVerificationCodeDeletePrompt,
  buildVerificationCodeModal,
} from "../interactions/verificationAdmin.js";

export const verificationCommand: Command = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Configure KOS member verification")
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("Open the interactive verification control panel"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Review verification configuration and readiness"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("publish")
        .setDescription("Publish or update the verification embed"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("code")
        .setDescription("Manage verification access codes")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("create")
            .setDescription("Create a code using a private form"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("edit")
            .setDescription("Edit a verification code")
            .addStringOption((option) =>
              option
                .setName("code")
                .setDescription("Code to edit")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("delete")
            .setDescription("Delete a verification code")
            .addStringOption((option) =>
              option
                .setName("code")
                .setDescription("Code to delete")
                .setRequired(true)
                .setAutocomplete(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription(
              "List verification codes, limits, roles, and status",
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: "Verification can only be configured in a server.",
        flags: MessageFlags.Ephemeral,
      });
    }
    await ensureGuild({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL(),
    });

    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    if (group === "code") {
      if (subcommand === "create") {
        return interaction.showModal(buildVerificationCodeModal());
      }
      if (subcommand === "edit") {
        const code = await getVerificationCode(
          interaction.options.getString("code", true),
          guild.id,
        );
        return interaction.showModal(buildVerificationCodeModal(code));
      }
      if (subcommand === "delete") {
        const code = await getVerificationCode(
          interaction.options.getString("code", true),
          guild.id,
        );
        return interaction.reply({
          ...buildVerificationCodeDeletePrompt(code),
          flags: MessageFlags.Ephemeral,
        });
      }
      return listCodes(interaction);
    }

    if (subcommand === "publish") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let published: { messageId: string; updated: boolean };
      try {
        published = await publishVerificationPanel(guild);
      } catch (error) {
        const message =
          error instanceof VerificationSettingsError
            ? [
                error.message,
                ...error.issues.map((issue) => `• ${issue}`),
              ].join("\n")
            : error instanceof Error
              ? error.message
              : "Could not publish the verification panel.";
        return interaction.editReply(`${KOS.emoji.cross} ${message}`);
      }
      await audit({
        guildId: guild.id,
        category: LogCategory.VERIFICATION,
        action: "VERIFICATION_PANEL_PUBLISH",
        message: published.updated
          ? "Updated the verification panel"
          : "Published the verification panel",
        actorId: interaction.user.id,
        metadata: { messageId: published.messageId },
      });
      return interaction.editReply(
        `${KOS.emoji.check} ${published.updated ? "Updated" : "Published"} the verification panel.`,
      );
    }

    if (subcommand === "setup") {
      await ensureUnverifiedRole(guild).catch(() => undefined);
    }
    const panel = await buildVerificationAdminPanel(guild);
    return interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const codes = await listVerificationCodes(interaction.guildId, 100);
    const choices = codes
      .filter(
        (code) =>
          code.code.toLowerCase().includes(focused) ||
          code.description?.toLowerCase().includes(focused),
      )
      .slice(0, 25)
      .map((code) => ({
        name: `${code.active ? "●" : "○"} ${code.code}${code.description ? ` — ${code.description}` : ""}`.slice(
          0,
          100,
        ),
        value: code.id,
      }));
    return interaction.respond(choices);
  },
};

async function listCodes(interaction: ChatInputCommandInteraction) {
  const codes = await listVerificationCodes(interaction.guildId!, 100);
  if (codes.length === 0) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(KOS.colors.silver)
          .setTitle(`${KOS.emoji.diamond} Verification Codes`)
          .setDescription(
            "No codes yet. Run `/verification code create` to add one.",
          )
          .setFooter({ text: KOS.footer }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = codes.map((code) => {
    const status = !code.active
      ? "Inactive"
      : code.expiresAt && code.expiresAt <= new Date()
        ? "Expired"
        : code.maxUses !== null && code.uses >= code.maxUses
          ? "Exhausted"
          : "Active";
    const uses = `${code.uses}/${code.maxUses ?? "∞"}`;
    const expiry = code.expiresAt
      ? `<t:${Math.floor(code.expiresAt.getTime() / 1000)}:R>`
      : "Never";
    const roles = code.roleIds.length
      ? code.roleIds.map((id) => `<@&${id}>`).join(", ")
      : "Default only";
    return [
      `**${code.code}** · ${status} · Uses ${uses}`,
      `${code.description ?? "No description"} · Expires ${expiry}`,
      `Roles: ${roles} · ${code.oneTimePerMember ? "One use/member" : "Reusable/member"}`,
    ].join("\n");
  });

  const pages: string[] = [];
  let page = "";
  for (const line of lines) {
    if (`${page}\n\n${line}`.length > 3900) {
      pages.push(page);
      page = line;
    } else {
      page = page ? `${page}\n\n${line}` : line;
    }
  }
  if (page) pages.push(page);
  const embeds = pages.slice(0, 10).map((description, index) =>
    new EmbedBuilder()
      .setColor(KOS.colors.silver)
      .setTitle(
        index === 0
          ? `${KOS.emoji.diamond} Verification Codes`
          : `Verification Codes · ${index + 1}`,
      )
      .setDescription(description)
      .setFooter({
        text: `${KOS.footer} · ${codes.length} code${codes.length === 1 ? "" : "s"}`,
      }),
  );
  return interaction.reply({
    embeds,
    flags: MessageFlags.Ephemeral,
  });
}
