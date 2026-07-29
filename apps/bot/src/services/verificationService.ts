import { PermissionFlagsBits, type GuildMember } from "discord.js";
import {
  VerificationAttemptStatus,
  prisma,
  type VerificationCode,
  type VerificationSettings,
} from "@kos/db";
import {
  VerificationCodeError,
  assertCodeAvailable,
  validateVerificationCodeForAttempt,
} from "./verificationCodeService.js";
import { logVerification } from "./verificationLogger.js";
import { getOrCreateVerificationSettings } from "./verificationSettingsService.js";

const ATTEMPT_TTL_MS = 15 * 60 * 1000;

export class VerificationFlowError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "DISABLED"
      | "INVALID_ATTEMPT"
      | "EXPIRED_ATTEMPT"
      | "RULES_REQUIRED"
      | "CODE_REQUIRED"
      | "ROLE_CONFIGURATION"
      | "ROLE_ASSIGNMENT",
  ) {
    super(message);
    this.name = "VerificationFlowError";
  }
}

export async function beginVerification(input: {
  guildId: string;
  userId: string;
  codeValue?: string;
}): Promise<{
  attemptId: string;
  settings: VerificationSettings;
  code: VerificationCode | null;
}> {
  const settings = await getOrCreateVerificationSettings(input.guildId);
  if (!settings.enabled) {
    throw new VerificationFlowError(
      "Verification is not enabled in this server.",
      "DISABLED",
    );
  }

  let code: VerificationCode | null = null;
  if (settings.requireCode) {
    if (!input.codeValue?.trim()) {
      throw new VerificationFlowError(
        "A verification code is required.",
        "CODE_REQUIRED",
      );
    }
    code = await validateVerificationCodeForAttempt({
      guildId: input.guildId,
      userId: input.userId,
      value: input.codeValue,
      preventCodeReuse: settings.preventCodeReuse,
    });
  }

  const now = new Date();
  await prisma.verificationAttempt.updateMany({
    where: {
      guildId: input.guildId,
      userId: input.userId,
      status: VerificationAttemptStatus.PENDING,
      expiresAt: { lte: now },
    },
    data: { status: VerificationAttemptStatus.EXPIRED },
  });
  const attempt = await prisma.verificationAttempt.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      codeId: code?.id ?? null,
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS),
    },
  });
  return { attemptId: attempt.id, settings, code };
}

export type FinalizeVerificationResult =
  | {
      success: true;
      message: string;
      roleIds: string[];
      code: string | null;
      alreadyComplete: boolean;
    }
  | {
      success: false;
      message: string;
      reason: string;
    };

export async function finalizeVerification(input: {
  member: GuildMember;
  attemptId: string;
  acceptRules?: boolean;
}): Promise<FinalizeVerificationResult> {
  const { member, attemptId } = input;
  let claim: ClaimedAttempt;
  try {
    claim = await claimVerificationAttempt({
      attemptId,
      guildId: member.guild.id,
      userId: member.id,
      acceptRules: input.acceptRules ?? false,
    });
  } catch (error) {
    const settings = await getOrCreateVerificationSettings(member.guild.id);
    const reason =
      error instanceof Error ? error.message : "Unknown verification error";
    await logVerification({
      client: member.client,
      guild: member.guild,
      userId: member.id,
      success: false,
      reason,
    });
    return {
      success: false,
      message: settings.failureMessage,
      reason,
    };
  }

  if (claim.alreadyComplete) {
    return {
      success: true,
      message: renderVerificationMessage(claim.settings.successMessage, {
        userId: member.id,
        guildName: member.guild.name,
        code: claim.code?.code ?? null,
        roleIds: claim.roleIds,
      }),
      roleIds: claim.roleIds,
      code: claim.code?.code ?? null,
      alreadyComplete: true,
    };
  }

  const roleIds = [
    ...new Set([
      ...claim.settings.defaultRoleIds,
      ...(claim.code?.roleIds ?? []),
    ]),
  ].filter(
    (roleId) =>
      roleId &&
      roleId !== member.guild.id &&
      roleId !== claim.settings.unverifiedRoleId,
  );
  const newlyAdded = roleIds.filter(
    (roleId) => !member.roles.cache.has(roleId),
  );

  try {
    const botMember =
      member.guild.members.me ??
      (await member.guild.members.fetchMe().catch(() => null));
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new VerificationFlowError(
        "KOS is missing Manage Roles.",
        "ROLE_CONFIGURATION",
      );
    }
    for (const roleId of roleIds) {
      const role =
        member.guild.roles.cache.get(roleId) ??
        (await member.guild.roles.fetch(roleId).catch(() => null));
      if (!role) {
        throw new VerificationFlowError(
          `Configured role ${roleId} no longer exists.`,
          "ROLE_CONFIGURATION",
        );
      }
      if (!role.editable) {
        throw new VerificationFlowError(
          `KOS cannot assign @${role.name}; move the bot role above it.`,
          "ROLE_CONFIGURATION",
        );
      }
    }
    if (newlyAdded.length > 0) {
      await member.roles.add(newlyAdded, "KOS verification completed");
    }
    if (
      claim.settings.unverifiedRoleId &&
      member.roles.cache.has(claim.settings.unverifiedRoleId)
    ) {
      await member.roles.remove(
        claim.settings.unverifiedRoleId,
        "KOS verification completed",
      );
    }
  } catch (error) {
    if (newlyAdded.length > 0) {
      await member.roles
        .remove(newlyAdded, "Rollback incomplete KOS verification")
        .catch(() => undefined);
    }
    const reason =
      error instanceof Error
        ? error.message
        : "Discord role assignment failed.";
    await releaseVerificationClaim(attemptId, reason);
    await logVerification({
      client: member.client,
      guild: member.guild,
      userId: member.id,
      success: false,
      codeId: claim.code?.id ?? null,
      code: claim.code?.code ?? null,
      reason,
      roleIds,
      rulesAcceptedAt: claim.rulesAcceptedAt,
    });
    return {
      success: false,
      message: claim.settings.failureMessage,
      reason,
    };
  }

  try {
    await prisma.$transaction([
      prisma.verificationAttempt.update({
        where: { id: attemptId },
        data: {
          status: VerificationAttemptStatus.COMPLETED,
          failureReason: null,
        },
      }),
      prisma.memberVerification.upsert({
        where: {
          guildId_userId: {
            guildId: member.guild.id,
            userId: member.id,
          },
        },
        create: {
          guildId: member.guild.id,
          userId: member.id,
          codeId: claim.code?.id ?? null,
          roleIds,
          rulesAcceptedAt: claim.rulesAcceptedAt,
        },
        update: {
          codeId: claim.code?.id ?? null,
          roleIds: { set: roleIds },
          rulesAcceptedAt: claim.rulesAcceptedAt,
          verifiedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Roles were assigned, but verification state could not be finalized: ${error.message}`
        : "Roles were assigned, but verification state could not be finalized.";
    await logVerification({
      client: member.client,
      guild: member.guild,
      userId: member.id,
      success: false,
      codeId: claim.code?.id ?? null,
      code: claim.code?.code ?? null,
      reason,
      roleIds,
      rulesAcceptedAt: claim.rulesAcceptedAt,
    });
    return {
      success: false,
      message:
        "Your roles were updated, but KOS could not save the final verification record. Please contact an administrator.",
      reason,
    };
  }

  await logVerification({
    client: member.client,
    guild: member.guild,
    userId: member.id,
    success: true,
    codeId: claim.code?.id ?? null,
    code: claim.code?.code ?? null,
    reason: "Verification completed.",
    roleIds,
    rulesAcceptedAt: claim.rulesAcceptedAt,
  });
  return {
    success: true,
    message: renderVerificationMessage(claim.settings.successMessage, {
      userId: member.id,
      guildName: member.guild.name,
      code: claim.code?.code ?? null,
      roleIds,
    }),
    roleIds,
    code: claim.code?.code ?? null,
    alreadyComplete: false,
  };
}

interface ClaimedAttempt {
  settings: VerificationSettings;
  code: VerificationCode | null;
  roleIds: string[];
  rulesAcceptedAt: Date | null;
  alreadyComplete: boolean;
}

class RetryClaimError extends Error {}

async function claimVerificationAttempt(input: {
  attemptId: string;
  guildId: string;
  userId: string;
  acceptRules: boolean;
}): Promise<ClaimedAttempt> {
  for (let attemptNumber = 0; attemptNumber < 4; attemptNumber += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const [attempt, settings] = await Promise.all([
          tx.verificationAttempt.findFirst({
            where: {
              id: input.attemptId,
              guildId: input.guildId,
              userId: input.userId,
            },
            include: { code: true, redemption: true },
          }),
          tx.verificationSettings.findUnique({
            where: { guildId: input.guildId },
          }),
        ]);
        if (!attempt || !settings) {
          throw new VerificationFlowError(
            "Verification attempt was not found.",
            "INVALID_ATTEMPT",
          );
        }
        if (!settings.enabled) {
          throw new VerificationFlowError(
            "Verification is no longer enabled.",
            "DISABLED",
          );
        }
        if (attempt.status === VerificationAttemptStatus.COMPLETED) {
          const roleIds = [
            ...new Set([
              ...settings.defaultRoleIds,
              ...(attempt.code?.roleIds ?? attempt.redemption?.roleIds ?? []),
            ]),
          ];
          return {
            settings,
            code: attempt.code,
            roleIds,
            rulesAcceptedAt: attempt.rulesAcceptedAt,
            alreadyComplete: true,
          };
        }
        if (
          attempt.status === VerificationAttemptStatus.FAILED ||
          attempt.status === VerificationAttemptStatus.EXPIRED ||
          attempt.expiresAt <= new Date()
        ) {
          throw new VerificationFlowError(
            "Verification attempt expired. Start again from the Verify button.",
            "EXPIRED_ATTEMPT",
          );
        }

        const rulesAcceptedAt =
          attempt.rulesAcceptedAt ??
          (settings.requireRulesAcceptance && input.acceptRules
            ? new Date()
            : null);
        if (settings.requireRulesAcceptance && !rulesAcceptedAt) {
          throw new VerificationFlowError(
            "Accept the server rules before continuing.",
            "RULES_REQUIRED",
          );
        }
        if (settings.requireCode && !attempt.code) {
          throw new VerificationFlowError(
            "A valid verification code is required.",
            "CODE_REQUIRED",
          );
        }
        if (attempt.status === VerificationAttemptStatus.PROCESSING) {
          return {
            settings,
            code: attempt.code,
            roleIds: [
              ...new Set([
                ...settings.defaultRoleIds,
                ...(attempt.code?.roleIds ?? attempt.redemption?.roleIds ?? []),
              ]),
            ],
            rulesAcceptedAt,
            alreadyComplete: false,
          };
        }

        if (attempt.code) {
          assertCodeAvailable(attempt.code);
          if (settings.preventCodeReuse && attempt.code.oneTimePerMember) {
            const redeemed = await tx.verificationRedemption.findFirst({
              where: {
                guildId: input.guildId,
                codeId: attempt.code.id,
                userId: input.userId,
              },
              select: { id: true },
            });
            if (redeemed) {
              throw new VerificationCodeError(
                "This member already redeemed that code.",
                "ALREADY_REDEEMED",
              );
            }
          }
          const claimed = await tx.verificationCode.updateMany({
            where: {
              id: attempt.code.id,
              uses: attempt.code.uses,
              active: true,
            },
            data: { uses: { increment: 1 } },
          });
          if (claimed.count !== 1) throw new RetryClaimError();
          await tx.verificationRedemption.create({
            data: {
              guildId: input.guildId,
              codeId: attempt.code.id,
              attemptId: attempt.id,
              userId: input.userId,
              code: attempt.code.code,
              roleIds: attempt.code.roleIds,
            },
          });
        }

        const claimedAttempt = await tx.verificationAttempt.updateMany({
          where: {
            id: attempt.id,
            status: VerificationAttemptStatus.PENDING,
          },
          data: {
            status: VerificationAttemptStatus.PROCESSING,
            rulesAcceptedAt,
          },
        });
        if (claimedAttempt.count !== 1) throw new RetryClaimError();
        return {
          settings,
          code: attempt.code,
          roleIds: [
            ...new Set([
              ...settings.defaultRoleIds,
              ...(attempt.code?.roleIds ?? []),
            ]),
          ],
          rulesAcceptedAt,
          alreadyComplete: false,
        };
      });
    } catch (error) {
      if (error instanceof RetryClaimError && attemptNumber < 3) continue;
      throw error;
    }
  }
  throw new VerificationFlowError(
    "Verification is busy. Please try again.",
    "INVALID_ATTEMPT",
  );
}

async function releaseVerificationClaim(
  attemptId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const attempt = await tx.verificationAttempt.findUnique({
      where: { id: attemptId },
      include: { redemption: true },
    });
    if (!attempt) return;
    if (attempt.redemption) {
      await tx.verificationRedemption.delete({
        where: { attemptId },
      });
      if (attempt.redemption.codeId) {
        await tx.verificationCode.updateMany({
          where: {
            id: attempt.redemption.codeId,
            uses: { gt: 0 },
          },
          data: { uses: { decrement: 1 } },
        });
      }
    }
    await tx.verificationAttempt.update({
      where: { id: attemptId },
      data: {
        status: VerificationAttemptStatus.FAILED,
        failureReason: reason.slice(0, 1000),
      },
    });
  });
}

export function renderVerificationMessage(
  template: string,
  values: {
    userId: string;
    guildName: string;
    code: string | null;
    roleIds: string[];
  },
): string {
  return template
    .replaceAll("{user}", `<@${values.userId}>`)
    .replaceAll("{server}", values.guildName)
    .replaceAll("{code}", values.code ?? "Not required")
    .replaceAll(
      "{roles}",
      values.roleIds.length
        ? values.roleIds.map((roleId) => `<@&${roleId}>`).join(", ")
        : "Member access",
    )
    .slice(0, 4000);
}
