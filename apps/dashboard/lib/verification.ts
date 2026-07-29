const SNOWFLAKE = /^\d{5,25}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export const VERIFICATION_DEFAULTS = {
  enabled: false,
  verificationChannelId: null,
  rulesChannelId: null,
  logChannelId: null,
  unverifiedRoleId: null,
  allowedChannelIds: [] as string[],
  defaultRoleIds: [] as string[],
  welcomeTitle: "Welcome to KOS.",
  welcomeDescription:
    "Before accessing the server, please verify yourself.\n\nClick the button below to continue.",
  welcomeColor: 12632256,
  verifyButtonLabel: "Verify",
  verifyButtonEmoji: null,
  modalTitle: "Verify Access",
  modalFieldLabel: "Verification Code",
  modalPlaceholder: "Enter your access code...",
  requireCode: true,
  requireRulesAcceptance: false,
  preventCodeReuse: true,
  successMessage: "Verification complete. Welcome to KOS.",
  failureMessage: "That verification code is invalid, expired, or unavailable.",
  panelMessageId: null,
  panelPublishedAt: null,
  desiredEnabled: null,
  accessSyncRequested: false,
  accessCleanupRoleIds: [] as string[],
  panelPublishRequested: false,
  controlRequestId: null,
  controlRequestedAt: null,
  controlRequestedById: null,
  controlProcessedAt: null,
  controlError: null,
};

type ParseResult<T> = { value: T } | { error: string };

export interface VerificationSettingsInput {
  verificationChannelId?: string | null;
  rulesChannelId?: string | null;
  logChannelId?: string | null;
  unverifiedRoleId?: string | null;
  allowedChannelIds?: string[];
  defaultRoleIds?: string[];
  welcomeTitle?: string;
  welcomeDescription?: string;
  welcomeColor?: number;
  verifyButtonLabel?: string;
  verifyButtonEmoji?: string | null;
  modalTitle?: string;
  modalFieldLabel?: string;
  modalPlaceholder?: string;
  requireCode?: boolean;
  requireRulesAcceptance?: boolean;
  preventCodeReuse?: boolean;
  successMessage?: string;
  failureMessage?: string;
}

export interface VerificationControlInput {
  desiredEnabled?: boolean;
  syncAccess: boolean;
  publishPanel: boolean;
}

export function parseVerificationSettingsPatch(raw: unknown): ParseResult<{
  settings: VerificationSettingsInput;
  control: VerificationControlInput;
}> {
  if (!raw || typeof raw !== "object") {
    return { error: "Send a valid verification settings payload." };
  }
  const input = raw as Record<string, unknown>;
  const settings: VerificationSettingsInput = {};

  for (const key of [
    "verificationChannelId",
    "rulesChannelId",
    "logChannelId",
    "unverifiedRoleId",
  ] as const) {
    if (!(key in input)) continue;
    const parsed = optionalSnowflake(input[key]);
    if (parsed === undefined) {
      return { error: `${labelFor(key)} must be a valid Discord selection.` };
    }
    settings[key] = parsed;
  }

  if ("allowedChannelIds" in input) {
    const ids = snowflakeList(input.allowedChannelIds, 50);
    if (!ids) {
      return {
        error:
          "Welcome channels must contain no more than 50 valid Discord channels.",
      };
    }
    settings.allowedChannelIds = ids;
  }
  if ("defaultRoleIds" in input) {
    const ids = snowflakeList(input.defaultRoleIds, 10);
    if (!ids) {
      return {
        error:
          "Default roles must contain no more than 10 valid Discord roles.",
      };
    }
    settings.defaultRoleIds = ids;
  }

  const textFields: {
    key: keyof VerificationSettingsInput;
    label: string;
    min: number;
    max: number;
    nullable?: boolean;
  }[] = [
    { key: "welcomeTitle", label: "Welcome title", min: 1, max: 256 },
    {
      key: "welcomeDescription",
      label: "Welcome description",
      min: 1,
      max: 4000,
    },
    { key: "verifyButtonLabel", label: "Verify button label", min: 1, max: 80 },
    {
      key: "verifyButtonEmoji",
      label: "Verify button emoji",
      min: 0,
      max: 100,
      nullable: true,
    },
    { key: "modalTitle", label: "Modal title", min: 1, max: 45 },
    { key: "modalFieldLabel", label: "Modal field label", min: 1, max: 45 },
    { key: "modalPlaceholder", label: "Modal placeholder", min: 1, max: 100 },
    { key: "successMessage", label: "Success message", min: 1, max: 1900 },
    { key: "failureMessage", label: "Failure message", min: 1, max: 1900 },
  ];
  for (const field of textFields) {
    if (!(field.key in input)) continue;
    if (typeof input[field.key] !== "string") {
      return { error: `${field.label} must be text.` };
    }
    const value = (input[field.key] as string).trim();
    if (field.nullable && value.length === 0) {
      settings.verifyButtonEmoji = null;
      continue;
    }
    if (value.length < field.min || value.length > field.max) {
      return {
        error: `${field.label} must be ${field.min}–${field.max} characters.`,
      };
    }
    Object.assign(settings, { [field.key]: value });
  }

  if ("welcomeColor" in input) {
    const color = parseColor(input.welcomeColor);
    if (color === null) {
      return { error: "Welcome colour must be a six-digit hex colour." };
    }
    settings.welcomeColor = color;
  }

  for (const key of [
    "requireCode",
    "requireRulesAcceptance",
    "preventCodeReuse",
  ] as const) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "boolean") {
      return { error: `${labelFor(key)} must be on or off.` };
    }
    settings[key] = input[key] as boolean;
  }

  const desiredEnabled =
    "desiredEnabled" in input && typeof input.desiredEnabled === "boolean"
      ? input.desiredEnabled
      : undefined;
  if ("desiredEnabled" in input && typeof input.desiredEnabled !== "boolean") {
    return { error: "Verification state must be on or off." };
  }
  if ("syncAccess" in input && typeof input.syncAccess !== "boolean") {
    return { error: "Access sync must be on or off." };
  }
  if ("publishPanel" in input && typeof input.publishPanel !== "boolean") {
    return { error: "Panel publishing must be on or off." };
  }

  return {
    value: {
      settings,
      control: {
        desiredEnabled,
        syncAccess: input.syncAccess === true,
        publishPanel: input.publishPanel === true,
      },
    },
  };
}

export interface VerificationCodeInput {
  code: string;
  description: string | null;
  roleIds: string[];
  maxUses: number | null;
  expiresAt: Date | null;
  active: boolean;
  oneTimePerMember: boolean;
}

export function parseVerificationCodeInput(
  raw: unknown,
): ParseResult<VerificationCodeInput> {
  if (!raw || typeof raw !== "object") {
    return { error: "Send a valid verification code payload." };
  }
  const input = raw as Record<string, unknown>;
  const code =
    typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) {
    return {
      error:
        "Code must be 1–32 characters using letters, numbers, hyphens, or underscores.",
    };
  }
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 500) {
    return { error: "Description must be 500 characters or fewer." };
  }
  const roleIds = snowflakeList(input.roleIds ?? [], 10);
  if (!roleIds) {
    return {
      error: "Role grants must contain no more than 10 valid Discord roles.",
    };
  }

  let maxUses: number | null = null;
  if (
    input.maxUses !== null &&
    input.maxUses !== undefined &&
    input.maxUses !== ""
  ) {
    const parsed =
      typeof input.maxUses === "number" ? input.maxUses : Number(input.maxUses);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
      return {
        error:
          "Max uses must be a whole number from 1 to 1,000,000, or left blank.",
      };
    }
    maxUses = parsed;
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    if (typeof input.expiresAt !== "string") {
      return { error: "Expiration must be a valid date and time." };
    }
    const value = input.expiresAt.trim();
    if (value) {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) {
        return { error: "Expiration must be a valid date and time." };
      }
      expiresAt = new Date(timestamp);
    }
  }
  if (typeof input.active !== "boolean") {
    return { error: "Code status must be active or inactive." };
  }
  if (typeof input.oneTimePerMember !== "boolean") {
    return { error: "Member reuse must be on or off." };
  }

  return {
    value: {
      code,
      description: description || null,
      roleIds,
      maxUses,
      expiresAt,
      active: input.active,
      oneTimePerMember: input.oneTimePerMember,
    },
  };
}

export function colorToHex(color: number): string {
  return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, "0")}`;
}

function parseColor(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffff
  ) {
    return value;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function optionalSnowflake(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return SNOWFLAKE.test(id) ? id : undefined;
}

function snowflakeList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const unique = [
    ...new Set(
      value
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (
    unique.length !== value.length ||
    unique.some((id) => !SNOWFLAKE.test(id))
  ) {
    return null;
  }
  return unique;
}

function labelFor(value: string): string {
  return value
    .replace(/Id$/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}
