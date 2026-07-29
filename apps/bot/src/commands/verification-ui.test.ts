import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { VerificationSettings } from "@kos/db";
import {
  buildVerificationRulesMessage,
  buildVerificationWelcomeMessage,
} from "../embeds/verificationEmbed.js";
import {
  buildVerificationCodeModal,
  buildVerificationMessagesModal,
  buildVerificationModalCopyModal,
  buildVerificationWelcomeModal,
} from "../interactions/verificationAdmin.js";

const settings: VerificationSettings = {
  guildId: "guild",
  enabled: true,
  verificationChannelId: "123",
  rulesChannelId: "456",
  logChannelId: null,
  unverifiedRoleId: "789",
  allowedChannelIds: [],
  defaultRoleIds: [],
  welcomeTitle: "Welcome to KOS.",
  welcomeDescription: "Verify before continuing.",
  welcomeColor: 0xc0c0c0,
  verifyButtonLabel: "Verify",
  verifyButtonEmoji: null,
  modalTitle: "Verify Access",
  modalFieldLabel: "Verification Code",
  modalPlaceholder: "Enter your access code...",
  requireCode: true,
  requireRulesAcceptance: true,
  preventCodeReuse: true,
  successMessage: "Welcome {user}",
  failureMessage: "Invalid code.",
  panelMessageId: null,
  panelPublishedAt: null,
  desiredEnabled: null,
  accessSyncRequested: false,
  accessCleanupRoleIds: [],
  panelPublishRequested: false,
  controlRequestId: null,
  controlRequestedAt: null,
  controlRequestedById: null,
  controlProcessedAt: null,
  controlError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("builds valid Discord verification modals with optional fields empty", () => {
  assert.doesNotThrow(() => buildVerificationCodeModal().toJSON());
  assert.doesNotThrow(() => buildVerificationWelcomeModal(settings).toJSON());
  assert.doesNotThrow(() => buildVerificationModalCopyModal(settings).toJSON());
  assert.doesNotThrow(() => buildVerificationMessagesModal(settings).toJSON());
});

test("builds valid member welcome and rules component rows", () => {
  const payloads = [
    buildVerificationWelcomeMessage(settings),
    buildVerificationRulesMessage({
      settings,
      attemptId: "attempt",
      guildId: "guild",
    }),
  ];
  for (const payload of payloads) {
    assert.ok(payload.embeds?.length);
    for (const component of payload.components ?? []) {
      assert.doesNotThrow(() =>
        (
          component as ActionRowBuilder<MessageActionRowComponentBuilder>
        ).toJSON(),
      );
    }
  }
});
